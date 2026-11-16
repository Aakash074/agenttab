// Rebuilds the provider's settled-tab history from the chain, so a server whose disk was wiped
// (Render free tier) does not come back with an empty feed and zeroed stats.
//
// Source of truth: every settle pays the provider's P2PKH address, so the provider address's
// history lists every settled tab. A settle tx carries everything we need:
//   input 0  -> the tab outpoint (= open txid:vout) and the covenant redeem script
//               (constructor args: timeout, provider, agent, owner)
//   unlock   -> the 8-byte cumulative voucher amount the agent signed
//   output 1 -> owner remainder, so budget = amount + remainder
// Waived (cancel) tabs never pay the provider and are not recovered. The per-call count is not on
// chain: we store a lower bound, ceil(amount / highest route price).
import type { ElectrumNetworkProvider } from 'cashscript';
import {
  binToBigIntUint64LE, binToHex, decodeAuthenticationInstructions, decodeTransaction, hash160, hexToBin, vmNumberToBigInt,
} from '@bitauth/libauth';
import { DIRECT_TAG, p2pkhAddress } from '@agenttab/covenant';
import type { TabLedger, TabRecord } from './ledger.ts';

export interface ChainSource {
  /** Txids touching an address, any order. height <= 0 = unconfirmed. */
  history(address: string): Promise<{ txid: string; height: number }[]>;
  /** Raw tx hex plus its block time (unix seconds) when known. */
  tx(txid: string): Promise<{ hex: string; time?: number }>;
}

export function electrumSource(p: ElectrumNetworkProvider): ChainSource {
  return {
    async history(address) {
      const h = (await p.performRequest('blockchain.address.get_history', address)) as { tx_hash: string; height: number }[];
      return h.map((x) => ({ txid: x.tx_hash, height: x.height }));
    },
    async tx(txid) {
      try {
        const v = (await p.performRequest('blockchain.transaction.get', txid, true)) as { hex: string; blocktime?: number; time?: number };
        if (v && typeof v === 'object' && typeof v.hex === 'string') return { hex: v.hex, time: v.blocktime ?? v.time };
      } catch { /* server without verbose support */ }
      return { hex: await p.getRawTransaction(txid) };
    },
  };
}

const p2pkhLock = (pub: Uint8Array) => binToHex(Uint8Array.from([0x76, 0xa9, 0x14, ...hash160(pub), 0x88, 0xac]));
const pushData = (i: unknown) => (i && typeof i === 'object' && 'data' in i ? (i as { data: Uint8Array }).data : undefined);

export interface ParsedSettle {
  tab: string; openTxid: string; vout: number; ownerPub: string; agentPub: string; timeout: number;
  amount: bigint; budget: bigint; settleTxid: string; settleBytes: number; redeemHex: string;
}

/** Returns the tab a tx settled to `providerPub`, or undefined if the tx is anything else. */
export function parseSettle(txid: string, hex: string, providerPub: Uint8Array): ParsedSettle | undefined {
  const tx = decodeTransaction(hexToBin(hex));
  if (typeof tx === 'string' || tx.inputs.length !== 1 || tx.outputs.length !== 2) return undefined;
  const providerHex = binToHex(providerPub);
  if (binToHex(tx.outputs[0].lockingBytecode) !== p2pkhLock(providerPub)) return undefined;
  const unlock = decodeAuthenticationInstructions(tx.inputs[0].unlockingBytecode);
  // settle unlock: <amountBytes> <voucher> <providerSig> <selector 0> <redeemScript>
  if (unlock.length !== 5) return undefined;
  const amountBytes = pushData(unlock[0]);
  const redeem = pushData(unlock[4]);
  if (!amountBytes || amountBytes.length !== 8 || !redeem) return undefined;
  const head = decodeAuthenticationInstructions(redeem).slice(0, 4).map(pushData);
  const [timeoutBin, provider, agent, owner] = head;
  if (!timeoutBin || provider?.length !== 33 || agent?.length !== 33 || owner?.length !== 33) return undefined;
  if (binToHex(provider) !== providerHex) return undefined;
  if (binToHex(tx.outputs[1].lockingBytecode) !== p2pkhLock(owner)) return undefined;
  const timeout = vmNumberToBigInt(timeoutBin);
  if (typeof timeout === 'string') return undefined;
  const amount = binToBigIntUint64LE(amountBytes);
  const openTxid = binToHex(tx.inputs[0].outpointTransactionHash);
  const vout = tx.inputs[0].outpointIndex;
  return {
    tab: `${openTxid}:${vout}`, openTxid, vout, ownerPub: binToHex(owner), agentPub: binToHex(agent), timeout: Number(timeout),
    amount, budget: amount + tx.outputs[1].valueSatoshis, settleTxid: txid, settleBytes: hex.length / 2, redeemHex: binToHex(redeem),
  };
}

/** A 1¢ direct payment to the provider: OP_RETURN <"AGENTTAB"> <24-hex invoice id> plus sats to the provider's P2PKH. */
export function parseDirect(txid: string, hex: string, providerPub: Uint8Array): { invoice: string; txid: string; amount: bigint } | undefined {
  const tx = decodeTransaction(hexToBin(hex));
  if (typeof tx === 'string') return undefined;
  const lock = p2pkhLock(providerPub);
  let invoice: string | undefined;
  let amount = 0n;
  for (const o of tx.outputs) {
    if (binToHex(o.lockingBytecode) === lock) amount += o.valueSatoshis;
    if (o.lockingBytecode[0] === 0x6a) {
      const [tag, id] = decodeAuthenticationInstructions(o.lockingBytecode.slice(1)).map(pushData);
      const idText = id ? new TextDecoder().decode(id) : '';
      if (tag && new TextDecoder().decode(tag) === DIRECT_TAG && /^[0-9a-f]{24}$/.test(idText)) invoice = idText;
    }
  }
  return invoice && amount > 0n ? { invoice, txid, amount } : undefined;
}

export interface ReplayOptions {
  /** Highest per-call price across routes: the call count is a lower bound, ceil(amount / maxPrice). */
  maxPrice: bigint;
  /** ownerPub hex -> tag (e.g. the attack panel's owner -> 'attack', kept out of the headline). */
  tagOwners?: Record<string, string>;
  /** Most recent N provider-address txs to inspect. */
  limit?: number;
  concurrency?: number;
  /** Mock/test networks have no cashaddr prefix of their own. */
  addressNetwork?: 'chipnet' | 'mainnet';
}

/** Restores settled tabs the ledger does not already know. Returns how many were added. */
export async function replayFromChain(ledger: TabLedger, src: ChainSource, o: ReplayOptions): Promise<number> {
  const address = p2pkhAddress(ledger.providerPub, o.addressNetwork ?? (ledger.network === 'mainnet' ? 'mainnet' : 'chipnet'));
  const known = new Set([...ledger.tabs.values()].map((t) => t.settledTxid).filter(Boolean));
  const hist = (await src.history(address))
    .filter((h) => !known.has(h.txid))
    .sort((a, b) => (b.height <= 0 ? Infinity : b.height) - (a.height <= 0 ? Infinity : a.height))
    .slice(0, o.limit ?? 300);
  const found: { p: ParsedSettle; at: string; openAt?: string }[] = [];
  const directs: { invoice: string; txid: string; amount: string; at: string }[] = [];
  const iso = (s?: number) => (s ? new Date(s * 1000).toISOString() : undefined);
  const queue = [...hist];
  const worker = async () => {
    for (let h = queue.shift(); h; h = queue.shift()) {
      try {
        const { hex, time } = await src.tx(h.txid);
        const p = parseSettle(h.txid, hex, ledger.providerPub);
        if (!p) {
          const d = parseDirect(h.txid, hex, ledger.providerPub);
          if (d) directs.push({ invoice: d.invoice, txid: d.txid, amount: d.amount.toString(), at: iso(time) ?? new Date().toISOString() });
          continue;
        }
        if (ledger.tabs.has(p.tab)) continue;
        if (ledger.contractFor(p).bytecode !== p.redeemHex) continue; // not our AgentTab covenant
        const openTime = await src.tx(p.openTxid).then((t) => t.time).catch(() => undefined);
        found.push({ p, at: iso(time) ?? new Date().toISOString(), openAt: iso(openTime) });
      } catch { /* skip one bad tx, keep going */ }
    }
  };
  await Promise.all(Array.from({ length: o.concurrency ?? 6 }, worker));
  const records = found.map(({ p, at, openAt }) => {
    const requests = Number((p.amount + o.maxPrice - 1n) / o.maxPrice);
    const tag = o.tagOwners?.[p.ownerPub];
    const rec: TabRecord = {
      id: p.tab, outpoint: { txid: p.openTxid, vout: p.vout }, ownerPub: p.ownerPub, agentPub: p.agentPub, timeout: p.timeout,
      budget: p.budget.toString(), contractAddress: ledger.contractFor(p).address,
      highest: { amount: p.amount.toString(), sig: '' }, requests, openedAt: openAt ?? at, status: 'settled',
      settledTxid: p.settleTxid, settledAmount: p.amount.toString(), settleTxBytes: p.settleBytes,
      restored: true, ...(tag ? { tag } : {}),
    };
    return { rec, settledAt: at };
  });
  ledger.restore(records, directs);
  return records.length + directs.length;
}
