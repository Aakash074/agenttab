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

  test('public close: anyone can settle a tab now; remainder goes back to the owner', async () => {
    const humanPub = pubFromPriv(humanPriv), demoPub = pubFromPriv(demoPriv);
    const tab = [...ledger.tabs.values()].find((t) => t.ownerPub === binToHex(humanPub) && t.status === 'open')!;
    await post('/demo/call', { tab: tab.id }); // 2nd call -> 2000 >= MIN_SETTLE
    const r = await post(`/tabs/${tab.id}/close`);
    assert.equal(r.status, 200);
    const b = await r.json();
    assert.equal(b.settledSats, '2000');
    assert.equal(b.returnedSats, '8000');
    assert.equal(ledger.tabs.get(tab.id)!.status, 'settled');
    void demoPub;
  });

  test('recycles provider proceeds back to the demo agent', async () => {
    const d2 = createDemo({ ledger, provider: net, network: 'mocknet' as never, agentPriv: demoPriv, selfUrl: () => base, route: '/api/oracle', price: 1000n, budgetSats: 3_100n, recycleFromPriv: providerPriv });
    const before = await d2.agent.balance();
    const txid = await d2.recycle(true);
    assert.match(txid!, /^[0-9a-f]{64}$/);
    assert.ok((await d2.agent.balance()) > before);
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
  test('drips while the wallet is low, refuses while it is funded, rate-limits bursts', async () => {
    const k = generatePrivateKey();
    const to = p2pkhAddress(pubFromPriv(k), 'chipnet');
    const r = await post('/faucet/drip', { address: to });
    assert.equal(r.status, 200);
    assert.match((await r.json()).txid, /^[0-9a-f]{64}$/);
    const got = (await net.getUtxos(to)).reduce((s, u) => s + u.satoshis, 0n);
    assert.equal(got, 25_000n);
    assert.equal((await post('/faucet/drip', { address: to })).status, 409, 'funded wallets are told so, not rate-limited');
    // spend it down below the refill threshold -> can drip again (no 24 h dead end)
    const [u] = await net.getUtxos(to);
    const { TransactionBuilder, SignatureTemplate } = await import('cashscript');
    await new TransactionBuilder({ provider: net }).addInput(u, new SignatureTemplate(k).unlockP2PKH())
      .addOutput({ to: faucet.address, amount: 21_000n }).addOutput({ to, amount: 3_000n }).send();
    assert.equal((await post('/faucet/drip', { address: to })).status, 200);
  });

  test('per-address burst limit returns 429 with a retry hint', async () => {
    const f2 = createFaucet({ network: 'mocknet', provider: net, faucetPriv, dripSats: 1_000n, refillBelowSats: 1_000_000n, limits: { perAddress: [1, 60_000] } });
    const a2 = createApp({ ledger, network: 'mocknet', extra: [f2.handler], routes: [] });
    await new Promise<void>((r) => a2.listen(0, r));
    const b2 = `http://127.0.0.1:${(a2.address() as AddressInfo).port}`;
    const to = p2pkhAddress(pubFromPriv(generatePrivateKey()), 'chipnet');
    const p2 = () => fetch(`${b2}/faucet/drip`, { method: 'POST', body: JSON.stringify({ address: to }) });
    assert.equal((await p2()).status, 200);
    const second = await p2();
    assert.equal(second.status, 429);
    assert.match((await second.json()).message, /Try again in \d+ min/);
    a2.close();
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
    for (const a of [100n, 200n, 300n, 1_300n]) {
      ml.charge({ tab: `${ok.txid}:0`, amount: a, sig: signVoucher(aPriv, op, a).sig }, a === 1_300n ? 1_000n : 100n);
    }
    const txid = await ml.settle(`${ok.txid}:0`);
    const back = await mnet.getUtxos(ownerAddr);
    assert.ok(back.some((u) => u.txid === txid && u.satoshis === 5_000n - 1_300n), 'remainder to owner on mainnet-encoded address');
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

describe('cancel path and mainnet demo mode', () => {
  async function tabFor(l: TabLedger, n: MockNetworkProvider, agentPub: Uint8Array, pPriv: Uint8Array, timeout = 1_000_000n) {
    const o = generatePrivateKey();
    const c = tabContract({ ownerPub: pubFromPriv(o), agentPub, providerPub: pubFromPriv(pPriv), timeout }, n);
    const addr = p2pkhAddress(pubFromPriv(o));
    n.addUtxo(addr, randomUtxo({ satoshis: 50_000n }));
    const open = await buildOpen({ provider: n, contract: c, payerPriv: o, fundingUtxos: await n.getUtxos(addr), budget: 5_000n, changeAddress: addr }).send();
    await l.register({ txid: open.txid, vout: 0, ownerPub: binToHex(pubFromPriv(o)), agentPub: binToHex(agentPub), timeout: Number(timeout) });
    return { id: `${open.txid}:0`, op: { txid: open.txid, vout: 0 }, ownerAddr: addr, openTxid: open.txid };
  }

  test('close with too little owed cancels: the owner gets the whole budget back minus the fee', async () => {
    const n = new MockNetworkProvider();
    const pPriv = generatePrivateKey(), aPriv = generatePrivateKey();
    const l = new TabLedger({ provider: n, providerPriv: pPriv, network: 'mocknet' });
    const t = await tabFor(l, n, pubFromPriv(aPriv), pPriv);
    l.charge({ tab: t.id, amount: 600n, sig: signVoucher(aPriv, t.op, 600n).sig }, 600n); // one call, below MIN_SETTLE
    const r = await l.close(t.id);
    assert.equal(r.action, 'cancel');
    const back = (await n.getUtxos(t.ownerAddr)).find((u) => u.txid === r.txid)!;
    assert.ok(back.satoshis > 5_000n - 1_000n);
    assert.equal(l.tabs.get(t.id)!.status, 'cancelled');
    assert.equal(l.events.at(-1)!.type, 'cancel');
  });

  test('tick auto-cancels a tab inside the safety window when nothing settle-worthy is owed', async () => {
    const n = new MockNetworkProvider();
    const pPriv = generatePrivateKey(), aPriv = generatePrivateKey();
    const l = new TabLedger({ provider: n, providerPriv: pPriv, network: 'mocknet' });
    n.setBlockHeight(1_000);
    const t = await tabFor(l, n, pubFromPriv(aPriv), pPriv, 2_000n);
    n.setBlockHeight(1_995);
    const r = await l.tick();
    assert.equal(r.settled.length, 1);
    assert.equal(l.tabs.get(t.id)!.status, 'cancelled');
  });

  test('mainnet demo mode: refuses without a visitor tab, never opens its own, pays a visitor tab', async () => {
    const n = new MockNetworkProvider();
    const pPriv = generatePrivateKey(), dPriv = generatePrivateKey();
    const l = new TabLedger({ provider: n, providerPriv: pPriv, network: 'mocknet' });
    let b3 = '';
    const d = createDemo({ ledger: l, provider: n, network: 'mocknet' as never, agentPriv: dPriv, selfUrl: () => b3, route: '/api/oracle', price: 600n, budgetSats: 5_000n, perIpMs: 0, visitorTabsOnly: true, maxTotalSats: 1_200n });
    const a3 = createApp({ ledger: l, network: 'mocknet', extra: [d.handler], routes: [{ path: '/api/oracle', price: 600n, description: 't', handler: () => ({ answer: 'ok' }) }] });
    await new Promise<void>((r) => a3.listen(0, r));
    b3 = `http://127.0.0.1:${(a3.address() as AddressInfo).port}`;
    n.addUtxo(p2pkhAddress(pubFromPriv(dPriv)), randomUtxo({ satoshis: 100_000n })); // even with funds, it must not open its own tab
    const none = await fetch(`${b3}/demo/call`, { method: 'POST' });
    assert.equal(none.status, 400);
    const t = await tabFor(l, n, pubFromPriv(dPriv), pPriv);
    for (const want of ['600', '1200']) {
      const r = await (await fetch(`${b3}/demo/call`, { method: 'POST', body: JSON.stringify({ tab: t.id }) })).json();
      assert.equal(r.cumulativeSats, want);
    }
    const capped = await fetch(`${b3}/demo/call`, { method: 'POST', body: JSON.stringify({ tab: t.id }) });
    assert.notEqual(capped.status, 200, 'total cap stops further spending');
    assert.equal([...l.tabs.values()].filter((x) => x.agentPub === binToHex(pubFromPriv(dPriv))).length, 1);
    a3.close();
  });
});

test('regression: house demo agent survives visitors closing their tabs (no stale-tab errors, no hex in messages)', async () => {
  const n = new MockNetworkProvider();
  const pPriv = generatePrivateKey(), dPriv = generatePrivateKey(), vPriv = generatePrivateKey();
  const l = new TabLedger({ provider: n, providerPriv: pPriv, network: 'mocknet' });
  let b4 = '';
  const d = createDemo({ ledger: l, provider: n, network: 'mocknet' as never, agentPriv: dPriv, selfUrl: () => b4, route: '/api/oracle', price: 1000n, budgetSats: 20_000n, perIpMs: 0 });
  const a4 = createApp({ ledger: l, network: 'mocknet', extra: [d.handler], routes: [{ path: '/api/oracle', price: 1000n, description: 't', handler: () => ({ answer: 'ok' }) }] });
  await new Promise<void>((r) => a4.listen(0, r));
  b4 = `http://127.0.0.1:${(a4.address() as AddressInfo).port}`;
  n.addUtxo(p2pkhAddress(pubFromPriv(dPriv)), randomUtxo({ satoshis: 200_000n }));
  // a visitor funds a tab for the house agent and runs it twice
  const vc = tabContract({ ownerPub: pubFromPriv(vPriv), agentPub: pubFromPriv(dPriv), providerPub: pubFromPriv(pPriv), timeout: 1_000_000n }, n);
  const va = p2pkhAddress(pubFromPriv(vPriv));
  n.addUtxo(va, randomUtxo({ satoshis: 50_000n }));
  const open = await buildOpen({ provider: n, contract: vc, payerPriv: vPriv, fundingUtxos: await n.getUtxos(va), budget: 10_000n, changeAddress: va }).send();
  const vt = `${open.txid}:0`;
  await l.register({ txid: open.txid, vout: 0, ownerPub: binToHex(pubFromPriv(vPriv)), agentPub: binToHex(pubFromPriv(dPriv)), timeout: 1_000_000 });
  for (let i = 0; i < 2; i++) assert.equal((await d.call(vt)).tab, vt);
  // the visitor closes it
  await l.close(vt);
  // background job keeps working on the agent's own tab, and never touches visitor tabs on its own
  for (let i = 0; i < 3; i++) {
    const r = await d.cronTick();
    assert.notEqual(r.tab, vt);
  }
  assert.equal((await d.info()).healthy, true);
  // a visitor asking for the closed tab gets a friendly 409, no raw hex
  const res = await fetch(`${b4}/demo/call`, { method: 'POST', body: JSON.stringify({ tab: vt }) });
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.error, 'tab_closed');
  assert.doesNotMatch(body.message, /[0-9a-f]{16}/);
  a4.close();
});
