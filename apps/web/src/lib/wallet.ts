import { electrumProvider } from '@agenttab/covenant';
// Two ways for a human to fund / refund a tab:
//  - WizardConnect (any compatible wallet, e.g. Paytaca): the dapp builds the tx, the wallet signs it.
//  - Chipnet test wallet: a throwaway key kept in this browser, chipnet only (for quick testing).
import {
  ElectrumNetworkProvider, SignatureTemplate, placeholderP2PKHUnlocker, placeholderSignature,
  type SpendableUtxo, type TransactionBuilder,
} from 'cashscript';
import {
  binToHex, cashAddressToLockingBytecode, decodePrivateKeyWif, encodePrivateKeyWif, generatePrivateKey, hexToBin, stringify,
} from '@bitauth/libauth';
import type { DappConnectionManager } from '@wizardconnect/dapp';
import {
  buildDirectPay, buildOpen, buildRefund, chainLockTip, p2pkhAddress, pubFromPriv, tabContract,
} from '@agenttab/covenant';
import type { Net } from '../config';

const providers: Partial<Record<Net, ElectrumNetworkProvider>> = {};
export const chain = (net: Net) => (providers[net] ??= electrumProvider(net));
/** Current tip in nLockTime units: compare with / derive tab timeouts from this, never the raw height. */
export const lockTipOf = (net: Net) => chainLockTip(chain(net), net);

export interface Wallet {
  kind: 'wizard' | 'burner';
  label: string;
  net: Net;
  ownerPub: Uint8Array;
  address: string;
  balance(): Promise<bigint>;
  openTab(p: { agentPub: Uint8Array; providerPub: Uint8Array; timeout: bigint; budget: bigint }): Promise<string>;
  refund(p: { agentPub: Uint8Array; providerPub: Uint8Array; timeout: bigint; txid: string; vout: number }): Promise<string>;
  /** 1¢ direct pay: signs (does not broadcast) `amount` to `payTo` + OP_RETURN <invoiceId>; returns the raw tx hex. */
  payDirect(p: { payTo: string; amount: bigint; invoiceId: string }): Promise<string>;
}

const lbHex = (address: string) => {
  const r = cashAddressToLockingBytecode(address);
  if (typeof r === 'string') throw new Error(r);
  return binToHex(r.bytecode);
};

async function findTabUtxo(net: Net, p: { ownerPub: Uint8Array; agentPub: Uint8Array; providerPub: Uint8Array; timeout: bigint; txid: string; vout: number }) {
  const contract = tabContract({ ownerPub: p.ownerPub, agentPub: p.agentPub, providerPub: p.providerPub, timeout: p.timeout }, chain(net));
  const utxo = (await contract.getUtxos()).find((u) => u.txid === p.txid && u.vout === p.vout);
  if (!utxo) throw new Error('Tab is already closed (settled or refunded).');
  return { contract, utxo };
}

async function assertRefundable(net: Net, timeout: bigint) {
  // Lock tip, not raw height: after faster blocks (chipnet, 2026-11-15) nLockTime counts 10-minute units.
  const tip = await lockTipOf(net);
  if (BigInt(tip) < timeout) throw new Error(`Refund unlocks at lock height ${timeout} (now ${tip}; ~${(Number(timeout) - tip) * 10} min).`);
}

// ---------- Chipnet test wallet ----------
const BURNER_KEY = 'agenttab.chipnet-test-wallet';
export function burnerWallet(): Wallet {
  let wif: string | null = null;
  try { wif = localStorage.getItem(BURNER_KEY); } catch { /* storage blocked */ }
  let priv: Uint8Array;
  const dec = wif ? decodePrivateKeyWif(wif) : undefined;
  if (dec && typeof dec !== 'string' && dec.type === 'testnet') priv = dec.privateKey;
  else {
    priv = generatePrivateKey();
    try { localStorage.setItem(BURNER_KEY, encodePrivateKeyWif(priv, 'testnet')); } catch { /* ephemeral */ }
  }
  const ownerPub = pubFromPriv(priv);
  const address = p2pkhAddress(ownerPub, 'chipnet');
  const net: Net = 'chipnet';
  return {
    kind: 'burner', label: 'Chipnet test wallet', net, ownerPub, address,
    async balance() { return (await chain(net).getUtxos(address)).reduce((s, u) => s + u.satoshis, 0n); },
    async openTab(p) {
      const contract = tabContract({ ownerPub, ...p }, chain(net));
      const fundingUtxos = await chain(net).getUtxos(address);
      const tx = await buildOpen({ provider: chain(net), contract, payerPriv: priv, fundingUtxos, budget: p.budget, changeAddress: address }).send();
      return tx.txid;
    },
    async refund(p) {
      await assertRefundable(net, p.timeout);
      const { contract, utxo } = await findTabUtxo(net, { ownerPub, ...p });
      const tx = await buildRefund({ provider: chain(net), contract, tabUtxo: utxo, ownerPriv: priv, timeout: p.timeout, network: net }).send();
      return tx.txid;
    },
    async payDirect(p) {
      const fundingUtxos = (await chain(net).getUtxos(address)).filter((u) => !u.token);
      return buildDirectPay({ provider: chain(net), ...p, fundingUtxos, changeAddress: address, payerPriv: priv }).builder.build();
    },
  };
}

/** The wallet refused (or the user rejected) a signing request. */
export class WalletDeclined extends Error { override name = 'WalletDeclined'; }

// ---------- WizardConnect ----------
const RECEIVE = 0, CHANGE = 1;
export function wizardWallet(manager: DappConnectionManager, net: Net, name: string): Wallet {
  const pub = (child: number, i: number) => manager.getPubkey(child, BigInt(i));
  const ownerPub = pub(RECEIVE, 0);
  if (!ownerPub) throw new Error('Wallet did not share a receive key yet.');
  const address = p2pkhAddress(ownerPub, net);
  // Scan a few receive/change addresses so funds anywhere near the front of the HD wallet are usable.
  const addresses = () => {
    const out: { address: string; path: [string, number] }[] = [];
    for (const [child, name, n] of [[RECEIVE, 'receive', 10], [CHANGE, 'change', 5]] as const) {
      for (let i = 0; i < n; i++) {
        const k = pub(child, i);
        if (k) out.push({ address: p2pkhAddress(k, net), path: [name, i] });
      }
    }
    return out;
  };
  const gather = async () => {
    const addrs = addresses();
    const lists = await Promise.all(addrs.map((a) => chain(net).getUtxos(a.address)));
    const pathByLb = new Map(addrs.map((a) => [lbHex(a.address), a]));
    return { utxos: lists.flat().filter((u) => !u.token), pathByLb };
  };
  const sign = async (builder: TransactionBuilder, inputPaths: [number, string, number][], prompt: string) => {
    const wc = builder.generateWcTransactionObject({ broadcast: false, userPrompt: prompt });
    // The relay JSON-encodes messages; libauth's stringify turns bigint/Uint8Array into the
    // "<bigint: Nn>" / "<Uint8Array: 0x..>" forms wallets parse (plain JSON.stringify throws on bigint).
    const res = await manager.signTransaction({ transaction: JSON.parse(stringify(wc)), inputPaths });
    if (res.error || !res.signedTransaction) throw new WalletDeclined(res.error ?? 'Wallet declined to sign.');
    return res.signedTransaction;
  };
  const signAndSend = async (builder: TransactionBuilder, inputPaths: [number, string, number][], prompt: string) =>
    chain(net).sendRawTransaction(await sign(builder, inputPaths, prompt));
  return {
    kind: 'wizard', label: name || 'WizardConnect wallet', net, ownerPub, address,
    async balance() { const { utxos } = await gather(); return utxos.reduce((s, u) => s + u.satoshis, 0n); },
    async openTab(p) {
      const contract = tabContract({ ownerPub, ...p }, chain(net));
      const { utxos, pathByLb } = await gather();
      const unlockerFor = (u: SpendableUtxo) => placeholderP2PKHUnlocker(pathByLb.get(u.lockingBytecode)!.address);
      const builder = buildOpen({ provider: chain(net), contract, unlockerFor, fundingUtxos: utxos, budget: p.budget, changeAddress: address });
      const inputPaths = utxos.map((u, i) => [i, ...pathByLb.get(u.lockingBytecode)!.path] as [number, string, number]);
      return signAndSend(builder, inputPaths, `Open an AgentTab with ${p.budget} sats`);
    },
    async refund(p) {
      await assertRefundable(net, p.timeout);
      const { contract, utxo } = await findTabUtxo(net, { ownerPub, ...p });
      const builder = buildRefund({ provider: chain(net), contract, tabUtxo: utxo, ownerSig: placeholderSignature(), timeout: p.timeout, to: address, network: net });
      return signAndSend(builder, [[0, 'receive', 0]], 'Refund your AgentTab');
    },
    async payDirect(p) {
      const { utxos, pathByLb } = await gather();
      const unlockerFor = (u: SpendableUtxo) => placeholderP2PKHUnlocker(pathByLb.get(u.lockingBytecode)!.address);
      const { builder, inputs } = buildDirectPay({ provider: chain(net), ...p, fundingUtxos: utxos, changeAddress: address, unlockerFor });
      const inputPaths = inputs.map((u, i) => [i, ...pathByLb.get(u.lockingBytecode)!.path] as [number, string, number]);
      // The server broadcasts after checking the payment, so a signed tx is never sent unless it buys the answer.
      return sign(builder, inputPaths, `Pay ${p.amount} sats for one AgentTab oracle answer`);
    },
  };
}

export const hex = binToHex;
export const unhex = hexToBin;
export { SignatureTemplate };
