// Offline checks for the headless WizardConnect test wallet (scripts/wc-test-wallet.ts):
// the dapp builds open/refund txs with placeholders exactly like apps/web/src/lib/wallet.ts, the
// request goes through a JSON round trip (as on the relay), the wallet signs, and the libauth VM
// validates the result against the covenant.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MockNetworkProvider, placeholderP2PKHUnlocker, placeholderSignature, randomUtxo,
} from 'cashscript';
import {
  decodeHdPublicKey, decodeTransaction, deriveHdPublicNodeChild, generateBip39Mnemonic, generatePrivateKey, hexToBin, stringify,
} from '@bitauth/libauth';
import { buildDirectPay, buildOpen, buildRefund, p2pkhAddress, pubFromPriv, tabContract, wizardConnectSignRequest } from '../src/index.ts';
import { hdWallet, signWcRequest } from '../scripts/lib/wc-signer.ts';

/** What the relay does to the dapp's request: JSON over the wire, JSON.parse. */
const overRelay = (req: unknown) => JSON.parse(JSON.stringify(req));
/** Paytaca's first step on a sign_transaction_request (paytaca-app src/wallet/wizardconnect/service.js). */
const paytacaDecode = (req: any) => {
  const t = decodeTransaction(hexToBin(req.transaction));
  if (typeof t === 'string') throw new Error('Failed to decode transaction: ' + t);
  return t;
};

function setup() {
  const provider = new MockNetworkProvider();
  const wallet = hdWallet(generateBip39Mnemonic());
  const owner = wallet.key('receive', 0);
  const agentPub = pubFromPriv(generatePrivateKey());
  const providerPub = pubFromPriv(generatePrivateKey());
  const timeout = 332_700n;
  const contract = tabContract({ ownerPub: owner.pub, agentPub, providerPub, timeout }, provider);
  return { provider, wallet, owner, agentPub, providerPub, timeout, contract };
}

test('dapp derives the same receive/change keys from the shared xpubs as the wallet signs with', () => {
  const { wallet } = setup();
  for (const [name, child] of [['receive', 0], ['change', 1]] as const) {
    const xpub = wallet.paths.find((p) => p.name === name)!.xpub;
    const node = decodeHdPublicKey(xpub);
    assert.notEqual(typeof node, 'string');
    for (const i of [0, 1, 5]) {
      const derived = deriveHdPublicNodeChild((node as Exclude<typeof node, string>).node, i);
      assert.notEqual(typeof derived, 'string');
      assert.deepEqual((derived as { publicKey: Uint8Array }).publicKey, wallet.key(name, i).pub, `${name}/${i} (child ${child})`);
    }
  }
});

test('raw cashscript WC object cannot be JSON-encoded (why the dapp must stringify it)', async () => {
  const { provider, contract, owner } = setup();
  const addr = p2pkhAddress(owner.pub);
  provider.addUtxo(addr, randomUtxo({ satoshis: 50_000n }));
  const b = buildOpen({ provider, contract, unlocker: placeholderP2PKHUnlocker(addr), fundingUtxos: await provider.getUtxos(addr), budget: 10_000n, changeAddress: addr });
  assert.throws(() => JSON.stringify(b.generateWcTransactionObject({ broadcast: false })), /BigInt/);
});

test('wallet signs a dapp-built openTab (P2PKH inputs on receive + change paths); VM accepts', async () => {
  const { provider, contract, wallet } = setup();
  const a0 = p2pkhAddress(wallet.key('receive', 0).pub);
  const c2 = p2pkhAddress(wallet.key('change', 2).pub);
  provider.addUtxo(a0, randomUtxo({ satoshis: 8_000n }));
  provider.addUtxo(c2, randomUtxo({ satoshis: 9_000n }));
  // Same shape as wizardWallet().openTab: utxos from several HD addresses, a placeholder unlocker per address.
  const tagged = [
    ...(await provider.getUtxos(a0)).map((u) => ({ u, address: a0, path: ['receive', 0] as const })),
    ...(await provider.getUtxos(c2)).map((u) => ({ u, address: c2, path: ['change', 2] as const })),
  ];
  const byLb = new Map(tagged.map((t) => [t.u.lockingBytecode, t]));
  const utxos = tagged.map((t) => t.u);
  const builder = buildOpen({
    provider, contract, fundingUtxos: utxos, budget: 12_000n, changeAddress: a0,
    unlockerFor: (u) => placeholderP2PKHUnlocker(byLb.get(u.lockingBytecode)!.address),
  });
  const wc = wizardConnectSignRequest(builder, { broadcast: false, userPrompt: 'Open an AgentTab' });
  const inputPaths = utxos.map((u, i) => [i, ...byLb.get(u.lockingBytecode)!.path] as [number, string, number]);
  const r = signWcRequest(overRelay(wc), inputPaths, wallet.key);
  assert.equal(r.vmVerify, true, String(r.vmVerify));
  assert.match(r.hex, /^[0-9a-f]+$/);
});

test('wallet signs a dapp-built refund: contract input with placeholder sig on receive/0; VM accepts', () => {
  const { provider, contract, wallet, owner, timeout } = setup();
  provider.addUtxo(contract.address, randomUtxo({ satoshis: 20_000n }));
  return contract.getUtxos().then(([tab]) => {
    const to = p2pkhAddress(owner.pub);
    const builder = buildRefund({ provider, contract, tabUtxo: tab, ownerSig: placeholderSignature(), timeout, to });
    const wc = wizardConnectSignRequest(builder, { broadcast: false, userPrompt: 'Refund your AgentTab' });
    // Paytaca's contract-input path needs contract.artifact.contractName, contract.redeemScript and the
    // 65-zero-byte placeholder push ("41" + 00*65) in sourceOutputs[i].unlockingBytecode.
    const so = overRelay(wc).sourceOutputs[0];
    assert.ok(so.contract?.artifact?.contractName && so.contract.abiFunction?.name === 'refund');
    assert.match(so.contract.redeemScript, /^[0-9a-f]+$/);
    assert.ok(so.unlockingBytecode.includes('41' + '00'.repeat(65)));
    const r = signWcRequest(overRelay(wc), [[0, 'receive', 0]], wallet.key);
    assert.equal(r.vmVerify, true, String(r.vmVerify));
    assert.ok(r.notes.some((n) => /replaced 1 placeholder sig/.test(n)), r.notes.join('\n'));

    // Same request signed with the wrong HD key must fail covenant validation.
    const bad = signWcRequest(overRelay(wc), [[0, 'receive', 1]], wallet.key);
    assert.notEqual(bad.vmVerify, true);
  });
});

test('regression: old request (stringified cashscript object) is what Paytaca rejected with "Uint32LE"', async () => {
  const { provider, wallet } = setup();
  const a0 = p2pkhAddress(wallet.key('receive', 0).pub);
  provider.addUtxo(a0, randomUtxo({ satoshis: 20_000n }));
  const { builder } = buildDirectPay({
    provider, payTo: p2pkhAddress(pubFromPriv(generatePrivateKey())), amount: 1_000n, invoiceId: 'abcdef0123456789',
    fundingUtxos: await provider.getUtxos(a0), changeAddress: a0, unlockerFor: () => placeholderP2PKHUnlocker(a0),
  });
  const old = overRelay(JSON.parse(stringify(builder.generateWcTransactionObject({ broadcast: false }))));
  assert.throws(() => paytacaDecode(old), /Error reading Uint32LE: requires 4 bytes\. Remaining bytes: 0/);
  assert.throws(() => signWcRequest(old, [[0, 'receive', 0]], wallet.key), /expected hex string/);
});

test('direct pay request is in Paytaca wire format (hex tx, hex bytes, <bigint>) and signs; VM accepts', async () => {
  const { provider, wallet } = setup();
  const a0 = p2pkhAddress(wallet.key('receive', 0).pub);
  provider.addUtxo(a0, randomUtxo({ satoshis: 20_000n }));
  const { builder, inputs } = buildDirectPay({
    provider, payTo: p2pkhAddress(pubFromPriv(generatePrivateKey())), amount: 1_000n, invoiceId: 'abcdef0123456789',
    fundingUtxos: await provider.getUtxos(a0), changeAddress: a0, unlockerFor: () => placeholderP2PKHUnlocker(a0),
  });
  const req = overRelay(wizardConnectSignRequest(builder, { broadcast: false, userPrompt: 'Pay' }));
  assert.equal(typeof req.transaction, 'string');
  assert.equal(req.transaction, builder.build(), 'transaction = encoded unsigned tx hex');
  const tx = paytacaDecode(req);
  assert.equal(tx.inputs.length, inputs.length);
  assert.equal(tx.inputs.length, req.sourceOutputs.length);
  for (const so of req.sourceOutputs) {
    assert.match(so.lockingBytecode, /^[0-9a-f]+$/);
    assert.match(so.outpointTransactionHash, /^[0-9a-f]{64}$/);
    assert.match(so.valueSatoshis, /^<bigint: \d+n>$/);
    assert.equal(so.unlockingBytecode, '', 'P2PKH placeholder: empty, so the wallet signs it');
  }
  assert.equal(req.broadcast, false);
  const r = signWcRequest(req, [[0, 'receive', 0]], wallet.key);
  assert.equal(r.vmVerify, true, String(r.vmVerify));
});
