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
const ownerPriv = generatePrivateKey(), providerPriv = generatePrivateKey();
const ownerPub = pubFromPriv(ownerPriv), providerPub = pubFromPriv(providerPriv);
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
  headers: amount === undefined ? {} : { 'x-payment': encodePaymentHeader('mocknet', { tab: tab(), amount, sig: sig ?? signVoucher(ownerPriv, outpoint, amount).sig }) },
});

before(async () => {
  await new Promise<void>((r) => app.listen(0, r));
  base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
  const contract = tabContract({ ownerPub, providerPub, timeout: TIMEOUT }, net);
  const addr = p2pkhAddress(ownerPub);
  net.addUtxo(addr, randomUtxo({ satoshis: 100_000n }));
  const open = await buildOpen({
    provider: net, contract, ownerPriv, fundingUtxos: await net.getUtxos(addr), budget: 10_000n, changeAddress: addr,
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
    const r = await fetch(`${base}/tabs`, { method: 'POST', body: JSON.stringify({ txid: '00'.repeat(32), vout: 0, ownerPub: binToHex(ownerPub), timeout: TIMEOUT.toString() }) });
    assert.equal(r.status, 400);
  });

  test('register tab, then pay 3 requests with cumulative vouchers', async () => {
    const r = await fetch(`${base}/tabs`, { method: 'POST', body: JSON.stringify({ ...outpoint, ownerPub: binToHex(ownerPub), timeout: TIMEOUT.toString() }) });
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
    const forged = signVoucher(providerPriv, outpoint, 4000n).sig;
    assert.equal((await (await get(4000n, forged)).json()).error, 'bad_signature');
  });

  test('concurrent requests with the same voucher: only one succeeds', async () => {
    const sig = signVoucher(ownerPriv, outpoint, 4000n).sig;
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
});
