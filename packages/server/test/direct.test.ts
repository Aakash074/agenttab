// 1¢ direct pay: invoice -> one on-chain tx (OP_RETURN-bound) -> one answer.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { MockNetworkProvider, TransactionBuilder, SignatureTemplate, randomUtxo } from 'cashscript';
import { generatePrivateKey, hashTransaction, hexToBin } from '@bitauth/libauth';
import { buildDirectPay, p2pkhAddress, pubFromPriv } from '@agenttab/covenant';
import { TabLedger } from '../src/ledger.ts';
import { createApp } from '../src/app.ts';
import { centInSats, createDirect, verifyDirectTx } from '../src/direct.ts';

const net = new MockNetworkProvider();
const providerPriv = generatePrivateKey(), payerPriv = generatePrivateKey(), otherPriv = generatePrivateKey();
const payTo = p2pkhAddress(pubFromPriv(providerPriv));
const payer = p2pkhAddress(pubFromPriv(payerPriv));
const ledger = new TabLedger({ provider: net, providerPriv, network: 'mocknet' });
let clock = Date.now();
const broadcasted: string[] = [];
const known = new Map<string, string>(); // txid -> hex the "node" knows
let rejectBroadcast: string | undefined;
const direct = createDirect({
  ledger, network: 'mocknet', payTo, priceSats: () => 2_000n, route: '/api/oracle', now: () => clock,
  answer: (u) => ({ answer: `oracle says hi to ${u.searchParams.get('q')}` }),
  broadcast: async (hex) => {
    if (rejectBroadcast) throw new Error(rejectBroadcast);
    broadcasted.push(hex);
    const id = hashTransaction(hexToBin(hex));
    known.set(id, hex);
    return id;
  },
  fetchRawTx: async (txid) => { const h = known.get(txid); if (!h) throw new Error('not found'); return h; },
  limits: { create: [1000, 60_000], pay: [1000, 60_000] },
});
const app = createApp({
  ledger, network: 'mocknet', extra: [direct.handler],
  direct: { route: '/api/oracle', payTo, priceSats: () => 2_000n },
  routes: [{ path: '/api/oracle', price: 1000n, description: 't', handler: () => ({ answer: 'ok' }) }],
});
let base = '';
const post = (path: string, body: unknown = {}) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

before(async () => {
  await new Promise<void>((r) => app.listen(0, r));
  base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
  for (let i = 0; i < 24; i++) net.addUtxo(payer, randomUtxo({ satoshis: 10_000n }));
});
after(() => app.close());

let utxoCursor = 0;
async function nextUtxo() { const all = await net.getUtxos(payer); return [all[utxoCursor++]]; }
async function payTx(o: { invoiceId: string; amount?: bigint; to?: string }) {
  const { builder } = buildDirectPay({ provider: net, payTo: o.to ?? payTo, amount: o.amount ?? 2_000n, invoiceId: o.invoiceId, fundingUtxos: await nextUtxo(), changeAddress: payer, payerPriv });
  return builder.build();
}
const invoice = async (q = 'price') => { const r = await post('/direct', { q }); assert.equal(r.status, 201); return r.json(); };

describe('1¢ direct pay', () => {
  test('402 advertises an exact option next to bch-credit', async () => {
    const b = await (await fetch(`${base}/api/oracle`)).json();
    assert.deepEqual(b.accepts.map((a: { scheme: string }) => a.scheme), ['bch-credit', 'exact']);
    assert.equal(b.accepts[1].payTo, payTo);
    assert.equal(b.accepts[1].maxAmountRequired, '2000');
  });

  test('invoice -> rawTx -> answer, broadcast, and a "direct" feed event', async () => {
    const inv = await invoice('what is BCH');
    assert.equal(inv.amountSats, '2000');
    assert.equal(inv.payTo, payTo);
    assert.deepEqual(inv.opReturn, ['AGENTTAB', inv.invoiceId]);
    const hex = await payTx({ invoiceId: inv.invoiceId });
    const r = await post(`/direct/${inv.invoiceId}/pay`, { rawTx: hex });
    assert.equal(r.status, 200);
    const b = await r.json();
    assert.equal(b.answer, 'oracle says hi to what is BCH');
    assert.equal(b.txid, hashTransaction(hexToBin(hex)));
    assert.equal(broadcasted.at(-1), hex);
    const ev = ledger.events.at(-1)!;
    assert.equal(ev.type, 'direct');
    assert.equal(ev.txid, b.txid);
    assert.equal(ev.amount, '2000');
    assert.equal(ledger.stats().directPayments, 1);
  });

  test('pay by txid (wallet broadcast it itself), 0-conf', async () => {
    const inv = await invoice();
    const hex = await payTx({ invoiceId: inv.invoiceId });
    const txid = hashTransaction(hexToBin(hex));
    const early = await post(`/direct/${inv.invoiceId}/pay`, { txid });
    assert.equal(early.status, 404, 'node does not know it yet');
    known.set(txid, hex);
    const r = await post(`/direct/${inv.invoiceId}/pay`, { txid });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).txid, txid);
  });

  test('replay: a txid pays once; a paid invoice cannot be paid again; same payment retried is idempotent', async () => {
    const a = await invoice();
    const hex = await payTx({ invoiceId: a.invoiceId });
    const txid = hashTransaction(hexToBin(hex));
    assert.equal((await post(`/direct/${a.invoiceId}/pay`, { rawTx: hex })).status, 200);
    const events = ledger.events.length;
    const again = await post(`/direct/${a.invoiceId}/pay`, { rawTx: hex });
    assert.equal(again.status, 200);
    assert.equal((await again.json()).repeat, true);
    assert.equal(ledger.events.length, events, 'no second feed event');
    const other = await payTx({ invoiceId: a.invoiceId });
    const r2 = await post(`/direct/${a.invoiceId}/pay`, { rawTx: other });
    assert.equal(r2.status, 409);
    assert.equal((await r2.json()).error, 'invoice_paid');
    const b = await invoice();
    const r3 = await post(`/direct/${b.invoiceId}/pay`, { txid });
    assert.equal(r3.status, 409);
    assert.equal((await r3.json()).error, 'txid_used');
    const r4 = await post(`/direct/${b.invoiceId}/pay`, { rawTx: hex });
    assert.equal(r4.status, 402, 'a tx bound to another invoice does not pay this one');
  });

  test('wrong amount is rejected and the invoice stays payable', async () => {
    const inv = await invoice();
    const r = await post(`/direct/${inv.invoiceId}/pay`, { rawTx: await payTx({ invoiceId: inv.invoiceId, amount: 1_999n }) });
    assert.equal(r.status, 402);
    assert.equal((await r.json()).error, 'underpaid');
    const ok = await post(`/direct/${inv.invoiceId}/pay`, { rawTx: await payTx({ invoiceId: inv.invoiceId }) });
    assert.equal(ok.status, 200);
  });

  test('wrong address is rejected', async () => {
    const inv = await invoice();
    const r = await post(`/direct/${inv.invoiceId}/pay`, { rawTx: await payTx({ invoiceId: inv.invoiceId, to: p2pkhAddress(pubFromPriv(otherPriv)) }) });
    assert.equal(r.status, 402);
    assert.equal((await r.json()).error, 'wrong_address');
  });

  test('missing OP_RETURN is rejected', async () => {
    const inv = await invoice();
    const [u] = await nextUtxo();
    const hex = new TransactionBuilder({ provider: net })
      .addInput(u, new SignatureTemplate(payerPriv).unlockP2PKH())
      .addOutput({ to: payTo, amount: 2_000n })
      .addOutput({ to: payer, amount: u.satoshis - 2_000n - 300n })
      .build();
    const r = await post(`/direct/${inv.invoiceId}/pay`, { rawTx: hex });
    assert.equal(r.status, 402);
    assert.equal((await r.json()).error, 'missing_op_return');
  });

  test('expired invoice is rejected', async () => {
    const inv = await invoice();
    const hex = await payTx({ invoiceId: inv.invoiceId });
    clock += 16 * 60_000;
    try {
      const r = await post(`/direct/${inv.invoiceId}/pay`, { rawTx: hex });
      assert.equal(r.status, 410);
      assert.equal((await r.json()).error, 'invoice_expired');
    } finally { clock -= 16 * 60_000; }
  });

  test('a tx the network rejects pays nothing and frees the invoice', async () => {
    const inv = await invoice();
    rejectBroadcast = 'bad-txns-inputs-missingorspent';
    try {
      const r = await post(`/direct/${inv.invoiceId}/pay`, { rawTx: await payTx({ invoiceId: inv.invoiceId }) });
      assert.equal(r.status, 400);
      assert.equal((await r.json()).error, 'broadcast_failed');
    } finally { rejectBroadcast = undefined; }
    assert.equal((await post(`/direct/${inv.invoiceId}/pay`, { rawTx: await payTx({ invoiceId: inv.invoiceId }) })).status, 200);
  });

  test('unknown invoice / garbage input', async () => {
    assert.equal((await post('/direct/0123456789abcdef01234567/pay', { txid: '00'.repeat(32) })).status, 404);
    const inv = await invoice();
    assert.equal((await post(`/direct/${inv.invoiceId}/pay`, { rawTx: 'zz' })).status, 400);
    assert.throws(() => verifyDirectTx('00', { id: inv.invoiceId, amountSats: 1n, payTo }));
  });

  test('price ≈1 US cent, never below dust', () => {
    assert.equal(centInSats(500), 2_000n);
    assert.equal(centInSats(undefined), 2_000n);
    assert.equal(centInSats(1_000_000), 546n);
  });
});
