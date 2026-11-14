// Property-style tests: many random cases instead of hand-picked ones.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomInt } from 'node:crypto';
import { MockNetworkProvider, SignatureTemplate, TransactionBuilder, randomUtxo } from 'cashscript';
import { bigIntToBinUint64LE, binToHex, generatePrivateKey, hexToBin } from '@bitauth/libauth';
import { buildOpen, buildSettle, p2pkhAddress, pubFromPriv, signVoucher, tabContract, verifyVoucher, voucherMessage } from '../src/index.ts';

const rndOutpoint = () => ({ txid: randomBytes(32).toString('hex'), vout: randomInt(0, 2 ** 16) });
const rndAmount = () => BigInt(randomInt(546, 2 ** 31)) * BigInt(randomInt(1, 1000));

describe('voucher properties (300 random cases each)', () => {
  const agent = generatePrivateKey();
  const agentPub = pubFromPriv(agent);

  test('sign → verify round-trips for any outpoint and amount', () => {
    for (let i = 0; i < 300; i++) {
      const v = signVoucher(agent, rndOutpoint(), rndAmount());
      assert.ok(verifyVoucher(agentPub, v));
    }
  });

  test('any change to amount, txid, vout or signature invalidates the voucher', () => {
    for (let i = 0; i < 300; i++) {
      const v = signVoucher(agent, rndOutpoint(), rndAmount());
      const mutations = [
        { ...v, amount: v.amount + BigInt(randomInt(1, 1_000_000)) },
        { ...v, amount: v.amount - 1n },
        { ...v, outpoint: { ...v.outpoint, vout: v.outpoint.vout + 1 } },
        { ...v, outpoint: { ...v.outpoint, txid: v.outpoint.txid.slice(0, 62) + ((parseInt(v.outpoint.txid.slice(62), 16) + 1) % 256).toString(16).padStart(2, '0') } },
        (() => { const s = hexToBin(v.sig); s[randomInt(0, 64)] ^= 1 << randomInt(0, 8); return { ...v, sig: binToHex(s) }; })(),
      ];
      for (const m of mutations) assert.equal(verifyVoucher(agentPub, m), false);
      assert.equal(verifyVoucher(pubFromPriv(generatePrivateKey()), v), false, 'other keys never verify');
    }
  });

  test('voucher message is fixed-length and injective over (txid, vout, amount)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const m = voucherMessage(rndOutpoint(), rndAmount());
      assert.equal(m.length, 8 + 32 + 4 + 8);
      const h = binToHex(m);
      assert.ok(!seen.has(h));
      seen.add(h);
    }
  });
});

describe('covenant properties (random budgets/amounts on the mock VM)', () => {
  async function freshTab(budget: bigint) {
    const provider = new MockNetworkProvider();
    const owner = generatePrivateKey(), agent = generatePrivateKey(), svc = generatePrivateKey();
    const contract = tabContract({ ownerPub: pubFromPriv(owner), agentPub: pubFromPriv(agent), providerPub: pubFromPriv(svc), timeout: 10_000_000n }, provider);
    const addr = p2pkhAddress(pubFromPriv(owner));
    provider.addUtxo(addr, randomUtxo({ satoshis: budget + 10_000n }));
    await buildOpen({ provider, contract, payerPriv: owner, fundingUtxos: await provider.getUtxos(addr), budget, changeAddress: addr }).send();
    const [tab] = await contract.getUtxos();
    return { provider, owner, agent, svc, contract, tab };
  }

  test('for any valid amount the settle succeeds and the owner gets exactly budget − amount', async () => {
    for (let i = 0; i < 6; i++) {
      const budget = BigInt(randomInt(5_000, 5_000_000));
      const amount = BigInt(randomInt(1_100, Number(budget - 546n)));
      const c = await freshTab(budget);
      const tx = await buildSettle({ provider: c.provider, contract: c.contract, tabUtxo: c.tab, providerPriv: c.svc, ownerPub: pubFromPriv(c.owner), voucher: signVoucher(c.agent, c.tab, amount) }).send();
      const back = (await c.provider.getUtxos(p2pkhAddress(pubFromPriv(c.owner)))).find((u) => u.txid === tx.txid);
      assert.equal(back?.satoshis, budget - amount, `budget ${budget} amount ${amount}`);
    }
  });

  test('for any overclaim δ > 0 the covenant rejects', async () => {
    for (let i = 0; i < 6; i++) {
      const budget = BigInt(randomInt(20_000, 2_000_000));
      const amount = BigInt(randomInt(1_100, Number(budget / 2n)));
      const delta = BigInt(randomInt(1, 5_000));
      const c = await freshTab(budget);
      const v = signVoucher(c.agent, c.tab, amount);
      const b = new TransactionBuilder({ provider: c.provider })
        .addInput(c.tab, c.contract.unlock.settle(new SignatureTemplate(c.svc), hexToBin(v.sig), bigIntToBinUint64LE(amount)))
        .addOutput({ to: p2pkhAddress(pubFromPriv(c.svc)), amount: amount + delta - 500n })
        .addOutput({ to: p2pkhAddress(pubFromPriv(c.owner)), amount: budget - amount - delta });
      await assert.rejects(b.send(), `budget ${budget} amount ${amount} delta ${delta}`);
    }
  });
});
