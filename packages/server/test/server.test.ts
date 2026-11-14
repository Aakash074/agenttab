import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { MockNetworkProvider, randomUtxo } from 'cashscript';
import { generatePrivateKey } from '@bitauth/libauth';
import {
  binToHex, buildOpen, p2pkhAddress, pubFromPriv, signVoucher, tabContract,
} from '@agenttab/covenant';
import { TabLedger } from '../src/ledger.ts';
import { createApp, encodePaymentHeader } from '../src/app.ts';

const PRICE = 1000n;
const net = new MockNetworkProvider();
const ownerPriv = generatePrivateKey(), agentPriv = generatePrivateKey(), providerPriv = generatePrivateKey();
const ownerPub = pubFromPriv(ownerPriv), agentPub = pubFromPriv(agentPriv), providerPub = pubFromPriv(providerPriv);
const TIMEOUT = 1_000_000n; // block height, far in the future for the mock (height 0)
const ledger = new TabLedger({ provider: net, providerPriv, network: 'mocknet' });
const app = createApp({
  ledger, network: 'mocknet',
  routes: [{ path: '/api/oracle', price: PRICE, description: 'test', handler: (u) => ({ answer: u.searchParams.get('q') }) }],
});
let base = '';
let outpoint: { txid: string; vout: number };
const tab = () => `${outpoint.txid}:${outpoint.vout}`;

const get = (amount?: bigint, sig?: string) => fetch(`${base}/api/oracle?q=hi`, {
  headers: amount === undefined ? {} : { 'x-payment': encodePaymentHeader('mocknet', { tab: tab(), amount, sig: sig ?? signVoucher(agentPriv, outpoint, amount).sig }) },
});

before(async () => {
  await new Promise<void>((r) => app.listen(0, r));
  base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
  const contract = tabContract({ ownerPub, agentPub, providerPub, timeout: TIMEOUT }, net);
  const addr = p2pkhAddress(ownerPub);
  net.addUtxo(addr, randomUtxo({ satoshis: 100_000n }));
  const open = await buildOpen({
    provider: net, contract, payerPriv: ownerPriv, fundingUtxos: await net.getUtxos(addr), budget: 10_000n, changeAddress: addr,
  }).send();
  outpoint = { txid: open.txid, vout: 0 };
});
after(() => app.close());

describe('paywall server', () => {
  test('unpaid request gets 402 with bch-credit terms', async () => {
    const r = await get();
    assert.equal(r.status, 402);
    const body = await r.json();
    assert.equal(body.accepts[0].scheme, 'bch-credit');
    assert.equal(body.accepts[0].maxAmountRequired, '1000');
    assert.equal(body.accepts[0].payTo, binToHex(providerPub));
  });

  test('voucher for an unregistered tab is refused', async () => {
    const r = await get(1000n);
    assert.equal(r.status, 402);
    assert.equal((await r.json()).error, 'unknown_tab');
  });

  test('registering a tab that is not on chain fails', async () => {
    const r = await fetch(`${base}/tabs`, { method: 'POST', body: JSON.stringify({ txid: '00'.repeat(32), vout: 0, ownerPub: binToHex(ownerPub), agentPub: binToHex(agentPub), timeout: TIMEOUT.toString() }) });
    assert.equal(r.status, 400);
  });

  test('register tab, then pay 3 requests with cumulative vouchers', async () => {
    const r = await fetch(`${base}/tabs`, { method: 'POST', body: JSON.stringify({ ...outpoint, ownerPub: binToHex(ownerPub), agentPub: binToHex(agentPub), timeout: TIMEOUT.toString() }) });
    assert.equal(r.status, 201);
    assert.equal((await r.json()).budget, '10000');
    for (const a of [1000n, 2000n, 3000n]) {
      const p = await get(a);
      assert.equal(p.status, 200, `request with voucher ${a}`);
      assert.deepEqual(await p.json(), { answer: 'hi' });
      const receipt = JSON.parse(Buffer.from(p.headers.get('x-payment-response')!, 'base64').toString());
      assert.equal(receipt.amount, a.toString());
    }
  });

  test('replay: re-sending an already-used voucher is refused', async () => {
    const r = await get(3000n);
    assert.equal(r.status, 402);
    assert.equal((await r.json()).error, 'replayed_voucher');
    const older = await get(1000n);
    assert.equal((await older.json()).error, 'replayed_voucher');
  });

  test('voucher skipping ahead or underpaying is refused', async () => {
    assert.equal((await (await get(5000n)).json()).error, 'wrong_amount');
    assert.equal((await (await get(3500n)).json()).error, 'wrong_amount');
  });

  test('forged voucher (wrong key) is refused', async () => {
    const forged = signVoucher(ownerPriv, outpoint, 4000n).sig; // owner key is NOT the voucher signer
    assert.equal((await (await get(4000n, forged)).json()).error, 'bad_signature');
  });

  test('concurrent requests with the same voucher: only one succeeds', async () => {
    const sig = signVoucher(agentPriv, outpoint, 4000n).sig;
    const rs = await Promise.all([get(4000n, sig), get(4000n, sig), get(4000n, sig)]);
    assert.deepEqual(rs.map((r) => r.status).sort(), [200, 402, 402]);
  });

  test('budget cap: cannot spend beyond budget - dust', async () => {
    for (const a of [5000n, 6000n, 7000n, 8000n, 9000n, 10_000n]) {
      const r = await get(a);
      assert.equal(r.status, a <= 10_000n - 546n ? 200 : 402, `voucher ${a}`);
    }
  });

  test('settle on demand pays out the highest voucher and closes the tab', async () => {
    const r = await fetch(`${base}/tabs/${tab()}/settle`, { method: 'POST' });
    assert.equal(r.status, 200);
    const { txid } = await r.json();
    assert.match(txid, /^[0-9a-f]{64}$/);
    const back = await net.getUtxos(p2pkhAddress(ownerPub));
    assert.ok(back.some((u) => u.txid === txid && u.satoshis === 10_000n - 9000n));
    assert.equal((await (await get(10_000n)).json()).error, 'tab_closed');
  });

  test('feed lists open, pay and settle events with txids', async () => {
    const f = await (await fetch(`${base}/feed`)).json();
    const types = f.events.map((e: any) => e.type);
    assert.equal(types[0], 'settle');
    assert.ok(types.includes('open') && types.filter((t: string) => t === 'pay').length === 9);
    assert.match(f.events[0].txid, /^[0-9a-f]{64}$/);
    assert.equal(f.stats.paidCalls, 9);
    const since = await (await fetch(`${base}/feed?since=${f.events[0].id}`)).json();
    assert.equal(since.events.length, 0);
  });

  test('auto-settle: inside the safety window vouchers are refused and tick settles the tab', async () => {
    const t2 = 2_000n;
    const contract = tabContract({ ownerPub, agentPub, providerPub, timeout: t2 }, net);
    const addr = p2pkhAddress(ownerPub);
    net.addUtxo(addr, randomUtxo({ satoshis: 100_000n }));
    const open = await buildOpen({
      provider: net, contract, payerPriv: ownerPriv, fundingUtxos: (await net.getUtxos(addr)).filter((u) => u.satoshis === 100_000n), budget: 10_000n, changeAddress: addr,
    }).send();
    net.setBlockHeight(1_000);
    const op = { txid: open.txid, vout: 0 };
    await ledger.register({ ...op, ownerPub: binToHex(ownerPub), agentPub: binToHex(agentPub), timeout: Number(t2) });
    const id = `${open.txid}:0`;
    ledger.charge({ tab: id, amount: 1000n, sig: signVoucher(agentPriv, op, 1000n).sig }, PRICE);
    ledger.charge({ tab: id, amount: 2000n, sig: signVoucher(agentPriv, op, 2000n).sig }, PRICE);
    assert.deepEqual((await ledger.tick()).settled, []); // far from timeout
    net.setBlockHeight(Number(t2) - 6);
    await ledger.refreshTip();
    assert.throws(() => ledger.charge({ tab: id, amount: 3000n, sig: signVoucher(agentPriv, op, 3000n).sig }, PRICE), /settle window/);
    const r = await ledger.tick();
    assert.equal(r.settled.length, 1);
    assert.equal(ledger.tabs.get(id)!.status, 'settled');
    assert.equal(ledger.events.at(-1)!.auto, true);
    net.setBlockHeight(0);
  });
});
