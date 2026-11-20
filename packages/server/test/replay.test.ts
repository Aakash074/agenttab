import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockNetworkProvider, randomUtxo } from 'cashscript';
import { generatePrivateKey } from '@bitauth/libauth';
import { binToHex, buildDirectPay, buildOpen, p2pkhAddress, pubFromPriv, signVoucher, tabContract } from '@agenttab/covenant';
import { TabLedger } from '../src/ledger.ts';
import { replayFromChain, type ChainSource } from '../src/replay.ts';

test('a wiped server rebuilds settled tabs, stats and feed from the provider address history', async () => {
  const net = new MockNetworkProvider();
  const providerPriv = generatePrivateKey(), ownerPriv = generatePrivateKey(), agentPriv = generatePrivateKey(), attackPriv = generatePrivateKey();
  const providerPub = pubFromPriv(providerPriv);
  const live = new TabLedger({ provider: net, providerPriv, network: 'mocknet' });
  const txs: string[] = [];

  async function tab(payer: Uint8Array, calls: number) {
    const ownerPub = pubFromPriv(payer), agentPub = pubFromPriv(agentPriv);
    const contract = tabContract({ ownerPub, agentPub, providerPub, timeout: 1_000_000n }, net);
    const addr = p2pkhAddress(ownerPub);
    net.addUtxo(addr, randomUtxo({ satoshis: 100_000n }));
    const open = await buildOpen({ provider: net, contract, payerPriv: payer, fundingUtxos: await net.getUtxos(addr), budget: 20_000n, changeAddress: addr }).send();
    const outpoint = { txid: open.txid, vout: 0 };
    await live.register({ ...outpoint, ownerPub: binToHex(ownerPub), agentPub: binToHex(agentPub), timeout: 1_000_000 });
    for (let i = 1; i <= calls; i++) live.charge({ tab: `${open.txid}:0`, ...signVoucher(agentPriv, outpoint, BigInt(i) * 1000n), amount: BigInt(i) * 1000n }, 1000n);
    const { txid } = await live.close(`${open.txid}:0`);
    txs.push(txid);
    return `${open.txid}:0`;
  }
  const settled = await tab(ownerPriv, 3);
  const waived = await tab(ownerPriv, 0); // cancel: never pays the provider, not recoverable
  const attack = await tab(attackPriv, 2);
  // An unrelated payment into the provider address must be ignored.
  const junk = p2pkhAddress(pubFromPriv(generatePrivateKey()));
  net.addUtxo(junk, randomUtxo({ satoshis: 10_000n }));
  txs.push('00'.repeat(32));

  const src: ChainSource = {
    history: async (a) => { assert.equal(a, p2pkhAddress(providerPub)); return txs.map((txid, i) => ({ txid, height: 100 + i })); },
    tx: async (txid) => { const hex = await net.getRawTransaction(txid); if (!hex) throw new Error('missing'); return { hex, time: 1_794_000_000 }; },
  };
  const fresh = new TabLedger({ provider: net, providerPriv, network: 'mocknet' });
  const epoch = fresh.epoch;
  await new Promise((r) => setTimeout(r, 2));
  const n = await replayFromChain(fresh, src, { maxPrice: 1000n, tagOwners: { [binToHex(pubFromPriv(attackPriv))]: 'attack' } });
  assert.equal(n, 2);
  assert.ok(!fresh.tabs.has(waived));
  const t = fresh.tabs.get(settled)!;
  assert.equal(t.status, 'settled');
  assert.equal(t.budget, '20000');
  assert.equal(t.settledAmount, '3000');
  assert.equal(t.requests, 3);
  assert.equal(t.ownerPub, binToHex(pubFromPriv(ownerPriv)));
  assert.equal(t.contractAddress, live.tabs.get(settled)!.contractAddress);
  assert.equal(fresh.tabs.get(attack)!.tag, 'attack');
  const s = fresh.stats();
  assert.equal(s.paidCalls, 3); // attack tab kept out of the headline
  assert.equal(s.onchainTxs, 2);
  // Fee figure from the real open + settle sizes, never a guess.
  const openBytes = (await net.getRawTransaction(settled.split(':')[0])).length / 2;
  assert.equal(t.openTxBytes, openBytes);
  assert.equal(s.feeSats, openBytes + t.settleTxBytes!);
  t.openTxBytes = undefined;
  assert.equal(fresh.stats().feeSats, null, 'unknown size: no fee figure');
  t.openTxBytes = openBytes;
  // The provider's real output (settled amount minus the miner fee it pays), live and after a rebuild.
  const liveSettle = live.events.find((e) => e.type === 'settle' && e.tab === settled)!;
  const restoredSettle = fresh.events.find((e) => e.type === 'settle' && e.tab === settled)!;
  assert.equal(restoredSettle.providerSats, liveSettle.providerSats);
  assert.ok(BigInt(restoredSettle.providerSats!) < 3000n && BigInt(restoredSettle.providerSats!) > 2000n);
  assert.deepEqual(fresh.events.map((e) => [e.id, e.type]), [[1, 'open'], [2, 'settle'], [3, 'open'], [4, 'settle']]);
  assert.equal(fresh.events.find((e) => e.type === 'settle' && e.tab === settled)!.calls, 3, 'calls derived from the settle tx');
  assert.notEqual(fresh.epoch, epoch);
  // Idempotent: a second pass adds nothing.
  assert.equal(await replayFromChain(fresh, src, { maxPrice: 1000n }), 0);
});

test('1¢ direct payments to the provider come back into the feed after a wipe', async () => {
  const net = new MockNetworkProvider();
  const providerPriv = generatePrivateKey(), payerPriv = generatePrivateKey();
  const providerPub = pubFromPriv(providerPriv);
  const payer = p2pkhAddress(pubFromPriv(payerPriv));
  net.addUtxo(payer, randomUtxo({ satoshis: 50_000n }));
  const { builder } = buildDirectPay({ provider: net, payTo: p2pkhAddress(providerPub), amount: 4_800n, invoiceId: 'ab'.repeat(12), fundingUtxos: await net.getUtxos(payer), changeAddress: payer, payerPriv });
  const { txid } = await builder.send();
  const src: ChainSource = { history: async () => [{ txid, height: 0 }], tx: async (t) => ({ hex: await net.getRawTransaction(t) }) };
  const fresh = new TabLedger({ provider: net, providerPriv, network: 'mocknet' });
  assert.equal(await replayFromChain(fresh, src, { maxPrice: 1000n }), 1);
  const ev = fresh.events.find((e) => e.type === 'direct')!;
  assert.equal(ev.txid, txid);
  assert.equal(ev.amount, '4800');
  assert.equal(ev.tab, `direct:${'ab'.repeat(12)}`);
  assert.equal(ev.timeUnknown, true, 'unconfirmed: no block time, so the restart time is not presented as the payment time');
  await replayFromChain(fresh, src, { maxPrice: 1000n });
  assert.equal(fresh.events.filter((e) => e.type === 'direct').length, 1, 'idempotent');
});
