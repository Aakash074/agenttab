import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { MockNetworkProvider, SignatureTemplate, TransactionBuilder, randomUtxo, type SpendableUtxo as Utxo } from 'cashscript';
import { bigIntToBinUint64LE, generatePrivateKey, hexToBin } from '@bitauth/libauth';
import {
  buildCancel,
  buildOpen,
  buildRefund,
  buildSettle,
  p2pkhAddress,
  pubFromPriv,
  signVoucher,
  tabContract,
  verifyVoucher,
  type Voucher,
} from '../src/index.ts';

const key = () => {
  const priv = generatePrivateKey();
  return { priv, pub: pubFromPriv(priv) };
};

const TIMEOUT = 1_900_000_000n; // unix seconds
const BUDGET = 100_000n;

async function setup() {
  const provider = new MockNetworkProvider();
  const owner = key();
  const agent = key();
  const svc = key();
  const params = { ownerPub: owner.pub, agentPub: agent.pub, providerPub: svc.pub, timeout: TIMEOUT };
  const contract = tabContract(params, provider);
  // Owner opens the tab from a funded P2PKH wallet through the SDK.
  const ownerAddr = p2pkhAddress(owner.pub);
  provider.addUtxo(ownerAddr, randomUtxo({ satoshis: 200_000n }));
  const funding = await provider.getUtxos(ownerAddr);
  const open = await buildOpen({
    provider, contract, payerPriv: owner.priv, fundingUtxos: funding, budget: BUDGET, changeAddress: ownerAddr,
  }).send();
  const [tab] = await contract.getUtxos();
  assert.equal(tab.txid, open.txid);
  assert.equal(tab.satoshis, BUDGET);
  return { provider, owner, agent, svc, contract, tab };
}

type Ctx = Awaited<ReturnType<typeof setup>>;

/** Hand-rolled settle so tests can tamper with any field. */
function rawSettle(c: Ctx, o: {
  voucher: Voucher;
  claimAmount?: bigint;
  providerOut?: { to: string; amount: bigint };
  ownerOut?: { to: string; amount: bigint };
  signer?: Uint8Array;
  inputs?: Utxo[];
  extraOutputs?: { to: string; amount: bigint }[];
}) {
  const claim = o.claimAmount ?? o.voucher.amount;
  const unlocker = c.contract.unlock.settle(
    new SignatureTemplate(o.signer ?? c.svc.priv), hexToBin(o.voucher.sig), bigIntToBinUint64LE(claim),
  );
  const b = new TransactionBuilder({ provider: c.provider }).addInputs(o.inputs ?? [c.tab], unlocker);
  b.addOutput(o.providerOut ?? { to: p2pkhAddress(c.svc.pub), amount: claim - 700n });
  b.addOutput(o.ownerOut ?? { to: p2pkhAddress(c.owner.pub), amount: c.tab.satoshis - claim });
  for (const x of o.extraOutputs ?? []) b.addOutput(x);
  return b.send();
}

const rejects = (p: Promise<unknown>) => assert.rejects(p);

async function addTabUtxo(c: Ctx, satoshis: bigint): Promise<Utxo> {
  c.provider.addUtxo(c.contract.address, randomUtxo({ satoshis }));
  const all = await c.contract.getUtxos();
  return all.find((u) => u.txid !== c.tab.txid)!;
}

describe('AgentTab covenant', () => {
  test('happy path: 3 cumulative vouchers, settle highest, remainder back to owner', async () => {
    const c = await setup();
    const vouchers = [1000n, 2000n, 3000n].map((a) => signVoucher(c.agent.priv, c.tab, a));
    for (const v of vouchers) assert.ok(verifyVoucher(c.agent.pub, v));
    await buildSettle({
      provider: c.provider, contract: c.contract, tabUtxo: c.tab,
      providerPriv: c.svc.priv, ownerPub: c.owner.pub, voucher: vouchers[2],
    }).send();
    assert.equal((await c.contract.getUtxos()).length, 0);
    const back = await c.provider.getUtxos(p2pkhAddress(c.owner.pub));
    assert.ok(back.some((u) => u.satoshis === BUDGET - 3000n), 'owner got exactly budget - 3000');
    const paid = await c.provider.getUtxos(p2pkhAddress(c.svc.pub));
    assert.equal(paid.length, 1);
    assert.ok(paid[0].satoshis < 3000n && paid[0].satoshis > 2000n, 'provider got 3000 minus fee');
  });

  test('overclaim: provider output above the signed amount is rejected', async () => {
    const c = await setup();
    const v = signVoucher(c.agent.priv, c.tab, 5000n);
    await rejects(rawSettle(c, {
      voucher: v,
      providerOut: { to: p2pkhAddress(c.svc.pub), amount: 6000n },
      ownerOut: { to: p2pkhAddress(c.owner.pub), amount: BUDGET - 6500n },
    }));
  });

  test('overclaim: provider bumps the amount argument beyond what the voucher signs', async () => {
    const c = await setup();
    await rejects(rawSettle(c, { voucher: signVoucher(c.agent.priv, c.tab, 5000n), claimAmount: 50_000n }));
  });

  test('owner shortchanged: remainder below budget - amount is rejected', async () => {
    const c = await setup();
    await rejects(rawSettle(c, {
      voucher: signVoucher(c.agent.priv, c.tab, 5000n),
      ownerOut: { to: p2pkhAddress(c.owner.pub), amount: BUDGET - 5000n - 1n },
    }));
  });

  test('wrong destination: provider share sent to a third address is rejected', async () => {
    const c = await setup();
    await rejects(rawSettle(c, {
      voucher: signVoucher(c.agent.priv, c.tab, 5000n),
      providerOut: { to: p2pkhAddress(key().pub), amount: 4500n },
    }));
  });

  test('wrong destination: remainder sent anywhere but the owner is rejected', async () => {
    const c = await setup();
    await rejects(rawSettle(c, {
      voucher: signVoucher(c.agent.priv, c.tab, 5000n),
      ownerOut: { to: p2pkhAddress(c.svc.pub), amount: BUDGET - 5000n },
    }));
  });

  test('extra output siphoning value is rejected', async () => {
    const c = await setup();
    await rejects(rawSettle(c, {
      voucher: signVoucher(c.agent.priv, c.tab, 5000n),
      ownerOut: { to: p2pkhAddress(c.owner.pub), amount: BUDGET - 5000n },
      extraOutputs: [{ to: p2pkhAddress(c.svc.pub), amount: 1000n }],
    }));
  });

  test('forged voucher (signed by provider key) is rejected', async () => {
    const c = await setup();
    const forged = signVoucher(c.svc.priv, c.tab, 5000n);
    assert.equal(verifyVoucher(c.agent.pub, forged), false);
    await rejects(rawSettle(c, { voucher: forged }));
  });

  test('voucher signed by the owner (not the agent key) is rejected', async () => {
    const c = await setup();
    await rejects(rawSettle(c, { voucher: signVoucher(c.owner.priv, c.tab, 5000n) }));
  });

  test('agent key cannot refund (it can only sign vouchers)', async () => {
    const c = await setup();
    await rejects(buildRefund({
      provider: c.provider, contract: c.contract, tabUtxo: c.tab, ownerPriv: c.agent.priv, timeout: TIMEOUT,
      to: p2pkhAddress(c.agent.pub),
    }).send());
  });

  test('third party without provider key cannot settle', async () => {
    const c = await setup();
    await rejects(rawSettle(c, { voucher: signVoucher(c.agent.priv, c.tab, 5000n), signer: key().priv }));
  });

  test('voucher bound to outpoint: cannot be replayed on a second utxo at the same address', async () => {
    const c = await setup();
    const v = signVoucher(c.agent.priv, c.tab, 5000n);
    // A second utxo accidentally sent to the same tab address.
    const second = await addTabUtxo(c, BUDGET);
    await rejects(rawSettle({ ...c, tab: second }, { voucher: v }));
    // ...and the honest settle of the first one still works.
    await rawSettle(c, { voucher: v });
  });

  test('cannot bundle two tab utxos into one settle', async () => {
    const c = await setup();
    const second = await addTabUtxo(c, BUDGET);
    await rejects(rawSettle(c, { voucher: signVoucher(c.agent.priv, c.tab, 5000n), inputs: [c.tab, second] }));
  });

  test('min bounds: dust voucher and dust remainder are rejected', async () => {
    const c = await setup();
    // A sub-dust voucher can never produce a valid provider output (rejected by covenant/relay).
    await rejects((async () => rawSettle(c, {
      voucher: signVoucher(c.agent.priv, c.tab, 545n),
      providerOut: { to: p2pkhAddress(c.svc.pub), amount: 545n },
    }))());
    const big = BUDGET - 500n;
    await rejects((async () => rawSettle(c, {
      voucher: signVoucher(c.agent.priv, c.tab, big),
      providerOut: { to: p2pkhAddress(c.svc.pub), amount: big - 1000n },
      ownerOut: { to: p2pkhAddress(c.owner.pub), amount: 500n },
    }))());
  });

  test('early refund (locktime before timeout) is rejected', async () => {
    const c = await setup();
    await rejects(buildRefund({
      provider: c.provider, contract: c.contract, tabUtxo: c.tab, ownerPriv: c.owner.priv, timeout: TIMEOUT - 1n,
    }).send());
  });

  test('provider cannot use the refund path', async () => {
    const c = await setup();
    await rejects(buildRefund({
      provider: c.provider, contract: c.contract, tabUtxo: c.tab, ownerPriv: c.svc.priv, timeout: TIMEOUT,
    }).send());
  });

  test('owner refunds everything after the timeout', async () => {
    const c = await setup();
    await buildRefund({
      provider: c.provider, contract: c.contract, tabUtxo: c.tab, ownerPriv: c.owner.priv, timeout: TIMEOUT,
    }).send();
    assert.equal((await c.contract.getUtxos()).length, 0);
  });

  test('cancel: provider waives the tab, owner gets everything back minus the fee', async () => {
    const c = await setup();
    const tx = await buildCancel({ provider: c.provider, contract: c.contract, tabUtxo: c.tab, providerPriv: c.svc.priv, ownerPub: c.owner.pub }).send();
    const back = (await c.provider.getUtxos(p2pkhAddress(c.owner.pub))).find((u) => u.txid === tx.txid)!;
    assert.ok(back.satoshis >= BUDGET - 1000n && back.satoshis < BUDGET);
  });

  test('cancel: cannot pay anyone but the owner, cannot take an excessive fee, needs the provider key', async () => {
    const c = await setup();
    const cancel = (out: { to: string; amount: bigint }[], signer = c.svc.priv) => {
      const b = new TransactionBuilder({ provider: c.provider }).addInput(c.tab, c.contract.unlock.cancel(new SignatureTemplate(signer)));
      for (const o of out) b.addOutput(o);
      return b.send();
    };
    await rejects(cancel([{ to: p2pkhAddress(c.svc.pub), amount: BUDGET - 500n }]));                     // provider pays itself
    await rejects(cancel([{ to: p2pkhAddress(c.owner.pub), amount: BUDGET - 1_500n }]));                 // fee above cap
    await rejects(cancel([{ to: p2pkhAddress(c.owner.pub), amount: BUDGET - 500n }], c.agent.priv));     // agent key
    await rejects(cancel([{ to: p2pkhAddress(c.owner.pub), amount: BUDGET - 500n }], c.owner.priv));     // owner key
    await rejects(cancel([{ to: p2pkhAddress(c.owner.pub), amount: BUDGET - 5_000n }, { to: p2pkhAddress(c.svc.pub), amount: 4_000n }])); // split
    await cancel([{ to: p2pkhAddress(c.owner.pub), amount: BUDGET - 500n }]);                            // honest
  });
});
