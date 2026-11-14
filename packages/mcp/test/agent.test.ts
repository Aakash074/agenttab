import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { MockNetworkProvider, randomUtxo } from 'cashscript';
import { generatePrivateKey } from '@bitauth/libauth';
import { binToHex, buildOpen, p2pkhAddress, pubFromPriv, tabContract } from '@agenttab/covenant';
import { TabLedger } from '../../server/src/ledger.ts';
import { createApp } from '../../server/src/app.ts';
import { AgentTabClient } from '../src/agent.ts';

const net = new MockNetworkProvider();
const providerPriv = generatePrivateKey(), agentPriv = generatePrivateKey(), ownerPriv = generatePrivateKey();
const ledger = new TabLedger({ provider: net, providerPriv, network: 'mocknet' });
const app = createApp({
  ledger, network: 'mocknet',
  routes: [
    { path: '/api/oracle', price: 1000n, description: 't', handler: () => ({ ok: true }) },
    { path: '/api/pricey', price: 9000n, description: 't', handler: () => ({ ok: true }) },
  ],
});
let base = '';
const mk = (o: Partial<ConstructorParameters<typeof AgentTabClient>[0]> = {}) => new AgentTabClient({
  agentPriv, network: 'mocknet' as never, provider: net, maxBudgetSats: 10_000n, maxPriceSats: 5_000n, maxTotalSats: 50_000n, tabBlocks: 144, ...o,
});

before(async () => {
  await new Promise<void>((r) => app.listen(0, r));
  base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
});
after(() => app.close());

describe('MCP agent client', () => {
  test('free URL passes through without paying', async () => {
    const r = await mk().fetchPaid(`${base}/.well-known/agenttab`);
    assert.equal(r.paid, false);
    assert.equal(r.status, 200);
  });

  test('uses a human-funded tab for this agent, cumulative vouchers per call', async () => {
    const ownerPub = pubFromPriv(ownerPriv), agentPub = pubFromPriv(agentPriv);
    const timeout = 1_000_000n;
    const contract = tabContract({ ownerPub, agentPub, providerPub: pubFromPriv(providerPriv), timeout }, net);
    const addr = p2pkhAddress(ownerPub);
    net.addUtxo(addr, randomUtxo({ satoshis: 100_000n }));
    const open = await buildOpen({ provider: net, contract, payerPriv: ownerPriv, fundingUtxos: await net.getUtxos(addr), budget: 20_000n, changeAddress: addr }).send();
    await ledger.register({ txid: open.txid, vout: 0, ownerPub: binToHex(ownerPub), agentPub: binToHex(agentPub), timeout: Number(timeout) });

    const agent = mk();
    const a = await agent.fetchPaid(`${base}/api/oracle`);
    const b = await agent.fetchPaid(`${base}/api/oracle`);
    assert.equal(a.paid && a.tab, `${open.txid}:0`);
    assert.equal(b.paid && b.cumulativeSats, '2000');
    assert.equal(agent.tabs.get(`${open.txid}:0`)!.fundedBy, 'owner');
  });

  test('refuses calls above the per-call price cap', async () => {
    await assert.rejects(mk().fetchPaid(`${base}/api/pricey`), /exceeds cap/);
  });

  test('refuses once the total spend cap is reached', async () => {
    await assert.rejects(mk({ maxTotalSats: 500n }).fetchPaid(`${base}/api/oracle`), /total spend cap/);
  });

  test('opens its own tab from agent funds when no funded tab is usable', async () => {
    const agent = mk();
    const agentAddr = p2pkhAddress(pubFromPriv(agentPriv));
    net.addUtxo(agentAddr, randomUtxo({ satoshis: 50_000n }));
    // pretend the human-funded tab was already used up and closed, forcing a new tab
    for (const id of ledger.tabs.keys()) agent.tabs.set(id, { id, origin: base, providerPub: '', ownerPub: '', timeout: 0, budget: '0', signed: '0', fundedBy: 'owner', closed: { action: 'x', txid: '' } });
    await agent.fetchPaid(`${base}/api/oracle`);
    const r = await agent.fetchPaid(`${base}/api/oracle`);
    assert.ok(r.paid);
    assert.equal(r.cumulativeSats, '2000');
    const t = agent.tabs.get(r.tab)!;
    assert.equal(t.fundedBy, 'agent');
    assert.equal(t.budget, '10000');
    const closed = await agent.close(r.tab);
    assert.equal(closed.action, 'settle');
    assert.match(closed.txid, /^[0-9a-f]{64}$/);
  });
});
