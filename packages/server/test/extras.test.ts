import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { MockNetworkProvider, randomUtxo } from 'cashscript';
import { encodePrivateKeyWif, generatePrivateKey } from '@bitauth/libauth';
import { binToHex, buildOpen, p2pkhAddress, pubFromPriv, signVoucher, tabContract } from '@agenttab/covenant';
import { TabLedger } from '../src/ledger.ts';
import { createApp } from '../src/app.ts';
import { createDemo } from '../src/demo.ts';
import { createFaucet } from '../src/faucet.ts';
import { networkKey, resolveNetwork } from '../src/env.ts';

const net = new MockNetworkProvider();
const providerPriv = generatePrivateKey(), demoPriv = generatePrivateKey(), faucetPriv = generatePrivateKey(), humanPriv = generatePrivateKey();
const ledger = new TabLedger({ provider: net, providerPriv, network: 'mocknet' });
let base = '';
const demo = createDemo({
  ledger, provider: net, network: 'mocknet' as never, agentPriv: demoPriv, selfUrl: () => base,
  route: '/api/oracle', price: 1000n, budgetSats: 3_100n, perIpMs: 0,
});
const faucet = createFaucet({ network: 'mocknet', provider: net, faucetPriv, dripSats: 25_000n });
const app = createApp({
  ledger, network: 'mocknet', extra: [demo.handler, faucet.handler],
  routes: [{ path: '/api/oracle', price: 1000n, description: 't', handler: () => ({ answer: 'ok' }) }],
});
const post = (path: string, body: unknown = {}) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

before(async () => {
  await new Promise<void>((r) => app.listen(0, r));
  base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
  net.addUtxo(p2pkhAddress(pubFromPriv(demoPriv)), randomUtxo({ satoshis: 100_000n }));
  net.addUtxo(faucet.address, randomUtxo({ satoshis: 200_000n }));
});
after(() => { demo.stop(); app.close(); });

describe('demo agent', () => {
  test('POST /demo/call makes a real paid call through the 402 flow on its own tab', async () => {
    const r = await post('/demo/call');
    assert.equal(r.status, 200);
    const b = await r.json();
    assert.equal(b.cumulativeSats, '1000');
    assert.equal(b.answer, 'ok');
    const pay = ledger.events.findLast((e) => e.type === 'pay')!;
    assert.equal(pay.demo, true);
    assert.ok(pay.contract?.startsWith('bchtest:'));
  });

  test('rolls over: settles its exhausted demo tab automatically', async () => {
    const r = await post('/demo/call');
    assert.equal((await r.json()).cumulativeSats, '2000');
    const settle = ledger.events.findLast((e) => e.type === 'settle');
    assert.ok(settle?.txid, 'demo tab settled once it could not pay another call');
    const next = await (await post('/demo/call')).json();
    assert.equal(next.cumulativeSats, '1000', 'a fresh demo tab was opened');
  });

  test('prefers a tab a visitor funded for the demo agent', async () => {
    const humanPub = pubFromPriv(humanPriv), demoPub = pubFromPriv(demoPriv);
    const timeout = 1_000_000n;
    const c = tabContract({ ownerPub: humanPub, agentPub: demoPub, providerPub: pubFromPriv(providerPriv), timeout }, net);
    const addr = p2pkhAddress(humanPub);
    net.addUtxo(addr, randomUtxo({ satoshis: 50_000n }));
    const open = await buildOpen({ provider: net, contract: c, payerPriv: humanPriv, fundingUtxos: await net.getUtxos(addr), budget: 10_000n, changeAddress: addr }).send();
    await ledger.register({ txid: open.txid, vout: 0, ownerPub: binToHex(humanPub), agentPub: binToHex(demoPub), timeout: Number(timeout) });
    const b = await (await post('/demo/call', { tab: `${open.txid}:0` })).json();
    assert.equal(b.tab, `${open.txid}:0`);
    assert.equal(b.cumulativeSats, '1000');
  });

  test('rate limited per client', async () => {
    const limited = createDemo({ ledger, provider: net, network: 'mocknet' as never, agentPriv: demoPriv, selfUrl: () => base, route: '/api/oracle', price: 1000n, budgetSats: 3_100n });
    const app2 = createApp({ ledger, network: 'mocknet', extra: [limited.handler], routes: [] });
    await new Promise<void>((r) => app2.listen(0, r));
    const b2 = `http://127.0.0.1:${(app2.address() as AddressInfo).port}`;
    const first = await fetch(`${b2}/demo/call`, { method: 'POST' });
    const second = await fetch(`${b2}/demo/call`, { method: 'POST' });
    assert.notEqual(first.status, 429);
    assert.equal(second.status, 429);
    app2.close();
  });
});

describe('chipnet drip faucet', () => {
  test('drips to a chipnet P2PKH address once, then rate-limits it', async () => {
    const to = p2pkhAddress(pubFromPriv(generatePrivateKey()), 'chipnet');
    const r = await post('/faucet/drip', { address: to });
    assert.equal(r.status, 200);
    assert.match((await r.json()).txid, /^[0-9a-f]{64}$/);
    const got = (await net.getUtxos(to)).reduce((s, u) => s + u.satoshis, 0n);
    assert.equal(got, 25_000n);
    assert.equal((await post('/faucet/drip', { address: to })).status, 429);
  });

  test('rejects mainnet / non-P2PKH addresses', async () => {
    const main = p2pkhAddress(pubFromPriv(generatePrivateKey()), 'mainnet');
    assert.equal((await post('/faucet/drip', { address: main })).status, 400);
    assert.equal((await post('/faucet/drip', { address: 'nonsense' })).status, 400);
  });

  test('refuses to exist on mainnet', () => {
    assert.throws(() => createFaucet({ network: 'mainnet', provider: net, faucetPriv, dripSats: 1n }), /chipnet-only/);
  });
});

describe('mainnet code path (mock chain, nothing broadcast)', () => {
  test('NETWORK=mainnet requires ALLOW_MAINNET=1; keys must match the network', () => {
    assert.throws(() => resolveNetwork({ NETWORK: 'mainnet' }), /ALLOW_MAINNET/);
    assert.equal(resolveNetwork({ NETWORK: 'mainnet', ALLOW_MAINNET: '1' }), 'mainnet');
    assert.equal(resolveNetwork({}), 'chipnet');
    const k = generatePrivateKey();
    assert.throws(() => networkKey(encodePrivateKeyWif(k, 'testnet'), 'K', 'mainnet'), /mainnet WIF/);
    assert.throws(() => networkKey(encodePrivateKeyWif(k, 'mainnet'), 'K', 'chipnet'), /testnet WIF/);
    assert.deepEqual(networkKey(encodePrivateKeyWif(k, 'mainnet'), 'K', 'mainnet'), k);
  });

  test('mainnet ledger: tiny-budget cap, vouchers, settle pays bitcoincash: P2PKH outputs', async () => {
    const mnet = new MockNetworkProvider();
    // Make the mock behave like mainnet (cashaddr prefix checks), still entirely in memory.
    (mnet as { network: string }).network = 'mainnet';
    const pPriv = generatePrivateKey(), oPriv = generatePrivateKey(), aPriv = generatePrivateKey();
    const ml = new TabLedger({ provider: mnet, providerPriv: pPriv, network: 'mainnet', maxBudgetSats: 10_000n });
    const ownerPub = pubFromPriv(oPriv), agentPub = pubFromPriv(aPriv);
    const timeout = 1_000_000n;
    const c = tabContract({ ownerPub, agentPub, providerPub: pubFromPriv(pPriv), timeout }, mnet);
    assert.ok(c.address.startsWith('bitcoincash:p'));
    const ownerAddr = p2pkhAddress(ownerPub, 'mainnet');
    assert.ok(ownerAddr.startsWith('bitcoincash:q'));
    mnet.addUtxo(ownerAddr, randomUtxo({ satoshis: 100_000n }));
    const tooBig = await buildOpen({ provider: mnet, contract: c, payerPriv: oPriv, fundingUtxos: await mnet.getUtxos(ownerAddr), budget: 20_000n, changeAddress: ownerAddr }).send();
    await assert.rejects(ml.register({ txid: tooBig.txid, vout: 0, ownerPub: binToHex(ownerPub), agentPub: binToHex(agentPub), timeout: Number(timeout) }), /up to 10000/);
    const ok = await buildOpen({ provider: mnet, contract: c, payerPriv: oPriv, fundingUtxos: (await mnet.getUtxos(ownerAddr)).filter((u) => u.txid === tooBig.txid), budget: 5_000n, changeAddress: ownerAddr }).send();
    await ml.register({ txid: ok.txid, vout: 0, ownerPub: binToHex(ownerPub), agentPub: binToHex(agentPub), timeout: Number(timeout) });
    const op = { txid: ok.txid, vout: 0 };
    for (const a of [100n, 200n, 300n, 1_100n]) {
      ml.charge({ tab: `${ok.txid}:0`, amount: a, sig: signVoucher(aPriv, op, a).sig }, a === 1_100n ? 800n : 100n);
    }
    const txid = await ml.settle(`${ok.txid}:0`);
    const back = await mnet.getUtxos(ownerAddr);
    assert.ok(back.some((u) => u.txid === txid && u.satoshis === 5_000n - 1_100n), 'remainder to owner on mainnet-encoded address');
  });
});

test('mainnet guard: a chipnet-encoded output is refused by the builder on a mainnet provider', async () => {
  const mnet = new MockNetworkProvider();
  (mnet as { network: string }).network = 'mainnet';
  const k = generatePrivateKey();
  const addr = p2pkhAddress(pubFromPriv(k), 'mainnet');
  mnet.addUtxo(addr, randomUtxo({ satoshis: 10_000n }));
  const c = tabContract({ ownerPub: pubFromPriv(k), agentPub: pubFromPriv(k), providerPub: pubFromPriv(k), timeout: 10n }, mnet);
  assert.throws(() => buildOpen({ provider: mnet, contract: c, payerPriv: k, fundingUtxos: [], budget: 5_000n, changeAddress: p2pkhAddress(pubFromPriv(k), 'chipnet') }), /insufficient|wrong network/);
});
