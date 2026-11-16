// "1¢ direct pay": the simplest way for a human to pay for one oracle answer. No tab, no covenant:
//   POST /direct {q}            -> invoice {invoiceId, payTo, amountSats, expiresAt, opReturn}
//   POST /direct/:id/pay {rawTx | txid}
//     -> the tx must pay >= amountSats to payTo and carry OP_RETURN <"AGENTTAB"> <invoiceId>;
//        0-conf is accepted (the node must have it: we broadcast rawTx, or look the txid up);
//        each invoice and each txid pays for exactly one answer.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  binToHex, cashAddressToLockingBytecode, decodeAuthenticationInstructions, decodeTransaction, hashTransaction, hexToBin, utf8ToBin,
} from '@bitauth/libauth';
import { DIRECT_TAG } from '@agenttab/covenant';
import { PaymentError, type TabLedger } from './ledger.ts';
import { json, readBody, type ExtraHandler } from './app.ts';
import { RateLimiter, clientIp } from './ratelimit.ts';

export interface Invoice {
  id: string;
  q: string;
  amountSats: bigint;
  payTo: string;
  createdAt: number;
  expiresAt: number;
  status: 'open' | 'verifying' | 'paid';
  txid?: string;
  result?: unknown;
}

export interface DirectOptions {
  ledger: TabLedger;
  network: string;
  /** Provider's P2PKH cash address (where the payment goes). */
  payTo: string;
  /** Price per answer, evaluated when the invoice is created. */
  priceSats: () => bigint;
  /** The paid answer (the oracle route handler). */
  answer: (url: URL) => Promise<unknown> | unknown;
  route?: string;
  /** Broadcast a raw tx (hex) -> txid. */
  broadcast: (hex: string) => Promise<string>;
  /** Look up a tx the node already knows (mempool or chain) -> raw hex. */
  fetchRawTx: (txid: string) => Promise<string>;
  ttlMs?: number;
  trustProxy?: boolean;
  /** Persists used txids so a restart cannot reopen them. */
  file?: string;
  limits?: { create?: [number, number]; pay?: [number, number] };
  now?: () => number;
}

const DUST = 546n;
const HEX64 = /^[0-9a-f]{64}$/i;

/** Pure check of a payment tx against an invoice. Returns the txid and the sats paid to `payTo`. */
export function verifyDirectTx(rawHex: string, inv: { id: string; amountSats: bigint; payTo: string }) {
  if (typeof rawHex !== 'string' || !/^([0-9a-f]{2})+$/i.test(rawHex) || rawHex.length > 200_000) throw new PaymentError('bad_tx', 'rawTx must be transaction hex', 400);
  const bin = hexToBin(rawHex);
  const tx = decodeTransaction(bin);
  if (typeof tx === 'string') throw new PaymentError('bad_tx', `cannot decode transaction: ${tx}`, 400);
  const lb = cashAddressToLockingBytecode(inv.payTo);
  if (typeof lb === 'string') throw new Error(`bad payTo ${inv.payTo}`);
  const want = binToHex(lb.bytecode);
  let paid = 0n;
  let tagged = false;
  const tag = binToHex(utf8ToBin(DIRECT_TAG)), id = binToHex(utf8ToBin(inv.id));
  for (const o of tx.outputs) {
    const script = binToHex(o.lockingBytecode);
    if (script === want && !o.token) paid += o.valueSatoshis;
    if (o.lockingBytecode[0] === 0x6a) {
      const pushes = decodeAuthenticationInstructions(o.lockingBytecode.slice(1))
        .map((i) => ('data' in i && i.data instanceof Uint8Array ? binToHex(i.data) : ''));
      if (pushes[0] === tag && pushes[1] === id) tagged = true;
    }
  }
  if (!tagged) throw new PaymentError('missing_op_return', `transaction must carry OP_RETURN "${DIRECT_TAG}" "${inv.id}"`);
  if (paid === 0n) throw new PaymentError('wrong_address', `transaction pays nothing to ${inv.payTo}`);
  if (paid < inv.amountSats) throw new PaymentError('underpaid', `paid ${paid} sats to ${inv.payTo}, invoice is ${inv.amountSats}`);
  return { txid: hashTransaction(bin), paidSats: paid };
}

export function createDirect(o: DirectOptions) {
  const now = o.now ?? Date.now;
  const ttl = o.ttlMs ?? 15 * 60_000;
  const route = o.route ?? '/api/oracle';
  const invoices = new Map<string, Invoice>();
  const usedTxids = new Set<string>();
  const reserved = new Set<string>();
  if (o.file && existsSync(o.file)) {
    try { for (const t of JSON.parse(readFileSync(o.file, 'utf8')).usedTxids ?? []) usedTxids.add(t); } catch { /* start empty */ }
  }
  const persist = () => {
    if (!o.file) return;
    mkdirSync(dirname(o.file), { recursive: true });
    writeFileSync(o.file, JSON.stringify({ usedTxids: [...usedTxids] }));
  };
  const l = o.limits ?? {};
  const createLimiter = new RateLimiter(...(l.create ?? [20, 10 * 60_000]));
  const payLimiter = new RateLimiter(...(l.pay ?? [40, 10 * 60_000]));

  const sweep = () => {
    const t = now();
    for (const [k, v] of invoices) if (v.status !== 'paid' ? t > v.expiresAt + 60_000 : t > v.expiresAt + 3_600_000) invoices.delete(k);
  };

  function create(qIn: unknown): Invoice {
    sweep();
    if (invoices.size > 5_000) throw new PaymentError('busy', 'too many open invoices, try again shortly', 503);
    const amount = o.priceSats();
    const amountSats = amount < DUST ? DUST : amount;
    const q = String(qIn ?? 'price').slice(0, 200) || 'price';
    const inv: Invoice = { id: randomBytes(12).toString('hex'), q, amountSats, payTo: o.payTo, createdAt: now(), expiresAt: now() + ttl, status: 'open' };
    invoices.set(inv.id, inv);
    return inv;
  }

  async function pay(id: string, body: { rawTx?: unknown; txid?: unknown }) {
    const inv = invoices.get(id);
    if (!inv) throw new PaymentError('unknown_invoice', 'unknown or expired invoice; create a new one with POST /direct', 404);
    const rawTx = typeof body?.rawTx === 'string' ? body.rawTx.trim().toLowerCase() : undefined;
    const givenTxid = typeof body?.txid === 'string' ? body.txid.trim().toLowerCase() : undefined;
    if (!rawTx && !givenTxid) throw new PaymentError('bad_request', 'send {rawTx} (preferred) or {txid}', 400);
    if (givenTxid && !HEX64.test(givenTxid)) throw new PaymentError('bad_txid', 'txid must be 32-byte hex', 400);
    if (inv.status === 'paid') {
      // Idempotent retry of the same payment (e.g. the response got lost); anything else is a replay.
      if (inv.txid && (givenTxid === inv.txid || (rawTx && verifyDirectTx(rawTx, inv).txid === inv.txid))) return { inv, result: inv.result, repeat: true };
      throw new PaymentError('invoice_paid', 'this invoice is already paid', 409);
    }
    if (inv.status === 'verifying') throw new PaymentError('in_progress', 'a payment for this invoice is being verified', 409);
    if (now() > inv.expiresAt) throw new PaymentError('invoice_expired', 'invoice expired; create a new one', 410);
    if (givenTxid && (usedTxids.has(givenTxid) || reserved.has(givenTxid))) throw new PaymentError('txid_used', 'this transaction already paid for an answer', 409);
    inv.status = 'verifying';
    let txid: string | undefined;
    try {
      let hex = rawTx;
      if (!hex) {
        txid = givenTxid!;
        reserved.add(txid);
        try { hex = (await o.fetchRawTx(txid)).toLowerCase(); } catch {
          throw new PaymentError('tx_not_found', 'the node does not know this transaction yet; retry in a few seconds or send rawTx', 404);
        }
      }
      const v = verifyDirectTx(hex, inv);
      if (txid && v.txid !== txid) throw new PaymentError('bad_tx', 'node returned a different transaction', 502);
      if (!txid) {
        if (usedTxids.has(v.txid) || reserved.has(v.txid)) throw new PaymentError('txid_used', 'this transaction already paid for an answer', 409);
        txid = v.txid;
        reserved.add(txid);
        try { await o.broadcast(hex); } catch (e) {
          const m = (e as Error).message ?? String(e);
          if (!/already (in|known)|txn-already|known transaction|already have/i.test(m)) throw new PaymentError('broadcast_failed', `the network rejected the transaction: ${m}`, 400);
        }
      }
      usedTxids.add(txid);
      persist();
      const url = new URL(`http://local${route}`);
      url.searchParams.set('q', inv.q);
      const result = await o.answer(url);
      inv.status = 'paid';
      inv.txid = txid;
      inv.result = result;
      o.ledger.recordDirect({ invoice: inv.id, txid, amount: v.paidSats, price: inv.amountSats, route });
      return { inv, result, paidSats: v.paidSats, repeat: false };
    } catch (e) {
      if (inv.status === 'verifying') inv.status = 'open';
      throw e;
    } finally {
      if (txid) reserved.delete(txid);
    }
  }

  const view = (inv: Invoice) => ({
    invoiceId: inv.id, q: inv.q, payTo: inv.payTo, amountSats: inv.amountSats.toString(), network: o.network,
    opReturn: [DIRECT_TAG, inv.id], expiresAt: new Date(inv.expiresAt).toISOString(), status: inv.status, txid: inv.txid,
    pay: `/direct/${inv.id}/pay`,
  });

  const handler: ExtraHandler = async (req, res, url) => {
    if (url.pathname === '/direct' && req.method === 'POST') {
      const wait = createLimiter.take(clientIp(req, !!o.trustProxy));
      if (wait) { json(res, 429, { error: 'rate_limited', message: `Too many invoices. Try again in ${Math.ceil(wait / 1000)} s.`, retryInMs: wait }); return true; }
      const body = await readBody(req);
      json(res, 201, view(create(body.q)));
      return true;
    }
    const m = url.pathname.match(/^\/direct\/([0-9a-f]{24})(\/pay)?$/);
    if (!m) return false;
    if (req.method === 'GET' && !m[2]) {
      const inv = invoices.get(m[1]);
      json(res, inv ? 200 : 404, inv ? view(inv) : { error: 'unknown_invoice' });
      return true;
    }
    if (req.method !== 'POST' || !m[2]) return false;
    const wait = payLimiter.take(clientIp(req, !!o.trustProxy));
    if (wait) { json(res, 429, { error: 'rate_limited', message: `Too many attempts. Try again in ${Math.ceil(wait / 1000)} s.`, retryInMs: wait }); return true; }
    const r = await pay(m[1], await readBody(req));
    const result = (r.result ?? {}) as Record<string, unknown>;
    json(res, 200, { ...result, invoiceId: r.inv.id, txid: r.inv.txid, amountSats: r.inv.amountSats.toString(), network: o.network, repeat: r.repeat || undefined });
    return true;
  };

  return { handler, create, pay, invoices, priceSats: o.priceSats, payTo: o.payTo };
}

/** ≈1 US cent in sats at `bchUsd`, never below dust; `fallback` when no price is known. */
export function centInSats(bchUsd: number | undefined, fallback = 2_000n): bigint {
  if (!bchUsd || !Number.isFinite(bchUsd) || bchUsd <= 0) return fallback;
  const s = BigInt(Math.ceil(1e6 / bchUsd));
  return s < DUST ? DUST : s > 50_000n ? 50_000n : s;
}
