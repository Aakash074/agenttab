// Relay self-test for the headless WizardConnect test wallet, no browser and no funds needed:
// runs the dapp side in Node (the same @wizardconnect/dapp DappConnectionManager the web app uses),
// starts scripts/wc-test-wallet.ts with the fresh wiz:// URI, waits for the pairing over the real
// relay, checks that the dapp derives the wallet's receive/0 address from the shared xpub, then asks
// the wallet to sign an openTab and a refund built exactly like apps/web/src/lib/wallet.ts does
// (on a MockNetworkProvider, so nothing touches the chain) and validates the returned txs in the VM.
//   node packages/covenant/scripts/wc-relay-selftest.ts
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MockNetworkProvider, placeholderP2PKHUnlocker, placeholderSignature, randomUtxo } from 'cashscript';
import { createVirtualMachineBch, decodeTransaction, generatePrivateKey, hexToBin } from '@bitauth/libauth';
import { initiateDappRelay } from '@wizardconnect/core';
import { DappConnectionManager } from '@wizardconnect/dapp';
import { buildOpen, buildRefund, p2pkhAddress, pubFromPriv, tabContract, wizardConnectSignRequest } from '../src/index.ts';
import { decodeWcTransaction, hdWallet } from './lib/wc-signer.ts';

const quietRelay = console.log.bind(console);
console.log = (...a: unknown[]) => { if (typeof a[0] === 'string' && a[0].startsWith('[relay]')) return; quietRelay(...a); };

const manager = new DappConnectionManager('AgentTab relay self-test', undefined, { session: false });
const dapp = initiateDappRelay((p) => manager.updateConnection(p.client, p.status));
console.log(`dapp URI: ${dapp.uri}`);

const walletScript = fileURLToPath(new URL('./wc-test-wallet.ts', import.meta.url));
const child = spawn(process.execPath, [walletScript, dapp.uri], { stdio: ['ignore', 'pipe', 'inherit'] });
let buf = '';
child.stdout.on('data', (d) => {
  const lines = (buf + String(d)).split('\n');
  buf = lines.pop()!;
  for (const l of lines) process.stdout.write(`  [wallet] ${l}\n`);
});
const done = (code: number) => { child.kill('SIGINT'); dapp.cleanup(); setTimeout(() => process.exit(code), 1500); };
const fail = (m: string) => { console.error(`FAIL: ${m}`); done(1); };
setTimeout(() => fail('timed out after 120 s'), 120_000).unref();

await new Promise<void>((resolve) => manager.once('walletready', () => resolve()));
const ownerPub = manager.getPubkey(0, 0n);
if (!ownerPub) { fail('dapp has no receive/0 pubkey after wallet_ready'); }
const stored = JSON.parse(readFileSync(new URL('../../../.data/wc-test-wallet.json', import.meta.url), 'utf8'));
const expected = p2pkhAddress(hdWallet(stored.mnemonic).key('receive', 0).pub, 'chipnet');
const seen = p2pkhAddress(ownerPub!, 'chipnet');
console.log(`dapp sees receive/0 = ${seen} (wallet: ${expected}) ${seen === expected ? 'OK' : 'MISMATCH'}`);
if (seen !== expected) fail('address mismatch');

const provider = new MockNetworkProvider();
const k = () => pubFromPriv(generatePrivateKey());
const timeout = 332_700n;
const contract = tabContract({ ownerPub: ownerPub!, agentPub: k(), providerPub: k(), timeout }, provider);
const vm = createVirtualMachineBch(true);
async function roundTrip(label: string, wc: ReturnType<typeof wizardConnectSignRequest>, inputPaths: [number, string, number][]) {
  const res = await manager.signTransaction({ transaction: wc as any, inputPaths });
  const tx = decodeTransaction(hexToBin(res.signedTransaction));
  if (typeof tx === 'string') return fail(`${label}: bad tx hex: ${tx}`);
  const { sourceOutputs } = decodeWcTransaction(wc);
  const ok = vm.verify({ transaction: tx, sourceOutputs });
  console.log(`${label}: wallet returned ${res.signedTransaction.length / 2} bytes, VM verify ${ok === true ? 'OK' : `FAILED ${ok}`}`);
  if (ok !== true) fail(label);
}

// openTab: a utxo on receive/0, placeholder P2PKH unlocker (wizardWallet().openTab)
provider.addUtxo(seen, randomUtxo({ satoshis: 30_000n }));
const funding = await provider.getUtxos(seen);
const open = buildOpen({ provider, contract, fundingUtxos: funding, budget: 10_000n, changeAddress: seen, unlockerFor: () => placeholderP2PKHUnlocker(seen) });
await roundTrip('openTab', wizardConnectSignRequest(open, { broadcast: false, userPrompt: 'Open an AgentTab with 10000 sats' }), funding.map((_, i) => [i, 'receive', 0]));

// refund: contract input with placeholderSignature(), signed with receive/0 (wizardWallet().refund)
provider.addUtxo(contract.address, randomUtxo({ satoshis: 10_000n }));
const [tab] = await contract.getUtxos();
const refund = buildRefund({ provider, contract, tabUtxo: tab, ownerSig: placeholderSignature(), timeout, to: seen });
await roundTrip('refund', wizardConnectSignRequest(refund, { broadcast: false, userPrompt: 'Refund your AgentTab' }), [[0, 'receive', 0]]);

console.log('PASS: pairing, xpub address derivation, openTab + refund signing over the WizardConnect relay');
done(0);
