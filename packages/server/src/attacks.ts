// "Try to cheat the tab": runs real attacks against a fresh tab on CHIPNET and reports the verbatim rejection.
// Covenant-level cheats are built with TransactionBuilder.build() (no local script check) and broadcast raw,
// so the rejection comes from the chipnet full node, not from our own code. Server-level cheats hit our own
// paywall over HTTP. Ends with the honest settle so visitors can compare.
import { SignatureTemplate, TransactionBuilder, type NetworkProvider } from 'cashscript';
import { bigIntToBinUint64LE, generatePrivateKey, hexToBin } from '@bitauth/libauth';
import {
  binToHex, buildOpen, buildRefund, p2pkhAddress, pubFromPriv, signVoucher, tabContract,
} from '@agenttab/covenant';
import type { TabLedger } from './ledger.ts';
import { json, type ExtraHandler } from './app.ts';
import { RateLimiter } from './ratelimit.ts';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export interface AttackResult {
  id: string;
  title: string;
  attempt: string;
  layer: 'chipnet node' | 'paywall server';
  outcome: 'rejected' | 'ACCEPTED';
  message: string;
  attemptedTxid?: string;
}

export interface AttackRun {
  at: string;
  network: string;
  tab: string;
  contract: string;
  openTxid: string;
  results: AttackResult[];
  honestSettleTxid?: string;
  ms: number;
}

const txidOf = async (hex: string) => {
  const { hash256, binToHex: b2h } = await import('@bitauth/libauth');
  return b2h(hash256(hexToBin(hex)).reverse());
};

export function createAttacks(o: {
  ledger: TabLedger; provider: NetworkProvider; network: 'chipnet' | 'mocknet';
  ownerPriv: Uint8Array; providerPriv: Uint8Array; selfUrl: () => string; price: bigint; file?: string;
}) {
  if ((o.network as string) === 'mainnet') throw new Error('attack panel is testnet-only');
  const ownerPub = pubFromPriv(o.ownerPriv);
  const ownerAddr = p2pkhAddress(ownerPub, 'chipnet');
  const providerPub = pubFromPriv(o.providerPriv);
  const limiter = new RateLimiter(1, 90_000);
  let last: AttackRun | undefined;
  try { if (o.file && existsSync(o.file)) last = JSON.parse(readFileSync(o.file, 'utf8')); } catch { /* ignore */ }
  let running: Promise<AttackRun> | undefined;

  /** Broadcast raw, bypassing local checks; return the node's verdict. */
  async function broadcast(b: TransactionBuilder) {
    const hex = b.build();
    const attemptedTxid = await txidOf(hex);
    // Prefer the raw Electrum call so we keep the node's verbatim reason (cashscript re-words it).
    const raw = (o.provider as { performRequest?: (m: string, ...p: string[]) => Promise<unknown> }).performRequest;
    try {
      if (raw) await raw.call(o.provider, 'blockchain.transaction.broadcast', hex);
      else await o.provider.sendRawTransaction(hex);
      return { ok: true, message: 'accepted by the node', attemptedTxid };
    } catch (e) {
      const err = e as { message?: string; error?: { message?: string } };
      const msg = err.error?.message ?? err.message ?? String(e);
      return { ok: false, message: msg.replace(/\s+/g, ' ').trim().slice(0, 400), attemptedTxid };
    }
  }

  async function run(): Promise<AttackRun> {
    const t0 = Date.now();
    const agentPriv = generatePrivateKey(); // fresh agent key for this run
    const agentPub = pubFromPriv(agentPriv);
    const tip = await o.provider.getBlockHeight();
    const timeout = tip + 144;
    const contract = tabContract({ ownerPub, agentPub, providerPub, timeout: BigInt(timeout) }, o.provider);
    const funding = (await o.provider.getUtxos(ownerAddr)).filter((u) => !u.token);
    const open = await buildOpen({ provider: o.provider, contract, payerPriv: o.ownerPriv, fundingUtxos: funding, budget: 6_000n, changeAddress: ownerAddr }).send();
    const outpoint = { txid: open.txid, vout: 0 };
    const id = `${open.txid}:0`;
    let tabUtxo;
    for (let i = 0; i < 8 && !tabUtxo; i++) {
      tabUtxo = (await contract.getUtxos()).find((u) => u.txid === open.txid);
      if (!tabUtxo) await new Promise((r) => setTimeout(r, 750));
    }
    if (!tabUtxo) throw new Error('attack tab not visible yet');
    await o.ledger.register({ txid: open.txid, vout: 0, ownerPub: binToHex(ownerPub), agentPub: binToHex(agentPub), timeout }, 'attack');
    const results: AttackResult[] = [];
    const providerAddr = p2pkhAddress(providerPub, 'chipnet');
    const budget = tabUtxo.satoshis;

    // Two honest paid calls -> highest voucher 2 * price.
    const header = (amount: bigint, sig: string) => Buffer.from(JSON.stringify({ x402Version: 1, scheme: 'bch-credit', payload: { tab: id, amount: amount.toString(), sig } })).toString('base64');
    const v1 = signVoucher(agentPriv, outpoint, o.price);
    const v2 = signVoucher(agentPriv, outpoint, 2n * o.price);
    for (const v of [v1, v2]) await fetch(`${o.selfUrl()}/api/oracle?q=attack-demo`, { headers: { 'x-payment': header(v.amount, v.sig) } });

    // 1. Replay a voucher the server already accepted.
    {
      const r = await fetch(`${o.selfUrl()}/api/oracle?q=replay`, { headers: { 'x-payment': header(v2.amount, v2.sig) } });
      const b = await r.json();
      results.push({ id: 'replay', title: 'Replay an old voucher', attempt: `re-send voucher #2 (${v2.amount} sats) for a new API call`, layer: 'paywall server',
        outcome: r.status === 200 ? 'ACCEPTED' : 'rejected', message: `HTTP ${r.status} ${b.error}: ${b.message}` });
    }

    const settleWith = (amountBytes: bigint, sig: string, providerOut: { to: string; amount: bigint }, ownerOut: { to: string; amount: bigint }, signer = o.providerPriv) =>
      new TransactionBuilder({ provider: o.provider })
        .addInput(tabUtxo!, contract.unlock.settle(new SignatureTemplate(signer), hexToBin(sig), bigIntToBinUint64LE(amountBytes)))
        .addOutput(providerOut).addOutput(ownerOut);
    const fee = 800n;

    // 2. Provider overclaims: pays itself more than the signed voucher.
    {
      const r = await broadcast(settleWith(v2.amount, v2.sig, { to: providerAddr, amount: v2.amount + 3_000n - fee }, { to: ownerAddr, amount: budget - v2.amount - 3_000n }));
      results.push({ id: 'overclaim', title: 'Provider overclaims', attempt: `settle with voucher for ${v2.amount} sats but pay the provider ${v2.amount + 3_000n - fee}`, layer: 'chipnet node',
        outcome: r.ok ? 'ACCEPTED' : 'rejected', message: r.message, attemptedTxid: r.attemptedTxid });
    }
    // 3. Provider edits the amount the voucher signed.
    {
      const r = await broadcast(settleWith(5_000n, v2.sig, { to: providerAddr, amount: 5_000n - fee }, { to: ownerAddr, amount: budget - 5_000n }));
      results.push({ id: 'forge-amount', title: 'Provider rewrites the voucher amount', attempt: 'claim 5000 sats using the signature over 2000', layer: 'chipnet node',
        outcome: r.ok ? 'ACCEPTED' : 'rejected', message: r.message, attemptedTxid: r.attemptedTxid });
    }
    // 4. Wrong remainder: shortchange the owner.
    {
      const r = await broadcast(settleWith(v2.amount, v2.sig, { to: providerAddr, amount: v2.amount - fee }, { to: providerAddr, amount: budget - v2.amount }));
      results.push({ id: 'wrong-remainder', title: 'Send the remainder elsewhere', attempt: 'valid voucher, but the leftover goes to the provider instead of the owner', layer: 'chipnet node',
        outcome: r.ok ? 'ACCEPTED' : 'rejected', message: r.message, attemptedTxid: r.attemptedTxid });
    }
    // 5. Owner refunds early.
    {
      const r = await broadcast(buildRefund({ provider: o.provider, contract, tabUtxo, ownerPriv: o.ownerPriv, timeout: BigInt(timeout), network: 'chipnet' }));
      results.push({ id: 'early-refund', title: 'Owner pulls the money early', attempt: `refund now (tip ${tip}) although the tab runs until block ${timeout}`, layer: 'chipnet node',
        outcome: r.ok ? 'ACCEPTED' : 'rejected', message: r.message, attemptedTxid: r.attemptedTxid });
    }
    // 6. Agent tries to withdraw via refund.
    {
      const b = new TransactionBuilder({ provider: o.provider })
        .addInput(tabUtxo, contract.unlock.refund(new SignatureTemplate(agentPriv)))
        .addOutput({ to: p2pkhAddress(agentPub, 'chipnet'), amount: budget - fee })
        .setLocktime(tip);
      const r = await broadcast(b);
      results.push({ id: 'agent-refund', title: 'Agent tries to withdraw', attempt: 'agent key signs the refund path and pays itself', layer: 'chipnet node',
        outcome: r.ok ? 'ACCEPTED' : 'rejected', message: r.message, attemptedTxid: r.attemptedTxid });
    }

    // 7. Provider "cancels" but pays itself instead of the owner.
    {
      const b = new TransactionBuilder({ provider: o.provider })
        .addInput(tabUtxo, contract.unlock.cancel(new SignatureTemplate(o.providerPriv)))
        .addOutput({ to: providerAddr, amount: budget - fee });
      const r = await broadcast(b);
      results.push({ id: 'cancel-to-self', title: 'Provider "cancels" into its own wallet', attempt: 'use the waive-the-tab path but send the budget to the provider', layer: 'chipnet node',
        outcome: r.ok ? 'ACCEPTED' : 'rejected', message: r.message, attemptedTxid: r.attemptedTxid });
    }

    // The honest way: settle exactly what was signed.
    let honestSettleTxid: string | undefined;
    for (let i = 0; i < 3 && !honestSettleTxid; i++) {
      try { honestSettleTxid = await o.ledger.settle(id); } catch (e) {
        console.error('attack honest settle', (e as Error).message);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    return { at: new Date().toISOString(), network: o.network, tab: id, contract: contract.address, openTxid: open.txid, results, honestSettleTxid, ms: Date.now() - t0 };
  }

  const handler: ExtraHandler = async (req, res, url) => {
    if (url.pathname === '/attacks' && req.method === 'GET') { json(res, 200, { last: last ?? null, running: !!running, ownerAddress: ownerAddr }); return true; }
    if (url.pathname !== '/attacks/run' || req.method !== 'POST') return false;
    if (running) { json(res, 202, { running: true, last: last ?? null }); return true; }
    const wait = limiter.take('all');
    if (wait) { json(res, 200, { last: last ?? null, cached: true, retryInMs: wait }); return true; }
    running = run();
    try {
      last = await running;
      if (o.file) writeFileSync(o.file, JSON.stringify(last, null, 1));
      json(res, 200, { last });
    }
    catch (e) { json(res, 503, { error: 'attack_run_failed', message: (e as Error).message, last: last ?? null }); }
    finally { running = undefined; }
    return true;
  };

  return { handler, run, get last() { return last; } };
}
