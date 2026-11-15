import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockNetworkProvider, randomUtxo } from 'cashscript';
import { generatePrivateKey } from '@bitauth/libauth';
import { binToHex, buildOpen, p2pkhAddress, pubFromPriv, signVoucher, tabContract } from '@agenttab/covenant';
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
  assert.deepEqual(fresh.events.map((e) => [e.id, e.type]), [[1, 'open'], [2, 'settle'], [3, 'open'], [4, 'settle']]);
  assert.notEqual(fresh.epoch, epoch);
  // Idempotent: a second pass adds nothing.
  assert.equal(await replayFromChain(fresh, src, { maxPrice: 1000n }), 0);
});
