// Property-style test of the paywall ledger: a random stream of fresh, replayed, skipped and forged vouchers.
// Invariant: the ledger accepts exactly the vouchers that continue the cumulative sequence by `price`,
// and its highest voucher always equals (accepted calls) × price.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { MockNetworkProvider, randomUtxo } from 'cashscript';
import { generatePrivateKey } from '@bitauth/libauth';
import { binToHex, buildOpen, p2pkhAddress, pubFromPriv, signVoucher, tabContract } from '@agenttab/covenant';
import { TabLedger } from '../src/ledger.ts';

test('ledger accepts exactly the in-sequence vouchers under a random adversarial stream (500 steps)', async () => {
  const net = new MockNetworkProvider();
  const providerPriv = generatePrivateKey(), owner = generatePrivateKey(), agent = generatePrivateKey(), other = generatePrivateKey();
  const ledger = new TabLedger({ provider: net, providerPriv, network: 'mocknet' });
  const price = 100n, budget = 1_000_000n, timeout = 1_000_000n;
  const contract = tabContract({ ownerPub: pubFromPriv(owner), agentPub: pubFromPriv(agent), providerPub: pubFromPriv(providerPriv), timeout }, net);
  const addr = p2pkhAddress(pubFromPriv(owner));
  net.addUtxo(addr, randomUtxo({ satoshis: 2_000_000n }));
  const open = await buildOpen({ provider: net, contract, payerPriv: owner, fundingUtxos: await net.getUtxos(addr), budget, changeAddress: addr }).send();
  const op = { txid: open.txid, vout: 0 };
  const id = `${open.txid}:0`;
  await ledger.register({ ...op, ownerPub: binToHex(pubFromPriv(owner)), agentPub: binToHex(pubFromPriv(agent)), timeout: Number(timeout) });

  let accepted = 0n;
  const seen: bigint[] = [];
  for (let i = 0; i < 500; i++) {
    const kind = randomInt(0, 5);
    const next = (accepted + 1n) * price;
    let amount: bigint, key = agent;
    if (kind === 0 && seen.length) amount = seen[randomInt(0, seen.length)];          // replay
    else if (kind === 1) amount = next + BigInt(randomInt(1, 5)) * price;             // skip ahead
    else if (kind === 2) amount = next - BigInt(randomInt(1, 50));                    // underpay
    else if (kind === 3) { amount = next; key = other; }                              // forged
    else amount = next;                                                               // honest
    const shouldAccept = key === agent && amount === next;
    let ok = true;
    try { ledger.charge({ tab: id, amount, sig: signVoucher(key, op, amount).sig }, price); } catch { ok = false; }
    assert.equal(ok, shouldAccept, `step ${i}: kind ${kind} amount ${amount} next ${next}`);
    if (ok) { accepted++; seen.push(amount); }
    assert.equal(BigInt(ledger.tabs.get(id)!.highest?.amount ?? '0'), accepted * price);
  }
  assert.ok(accepted > 50n, 'stream contained enough honest calls');
});
