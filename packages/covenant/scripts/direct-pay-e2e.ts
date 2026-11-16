// CHIPNET end-to-end check of the "1¢ direct pay" path, exactly as the web app's WizardConnect wallet does it:
// dapp side in Node (@wizardconnect/dapp), the headless WizardConnect test wallet (wc-test-wallet.ts) over the
// real relay, a payment built with buildDirectPay + placeholder unlockers, signed by the wallet, then
// POST /direct -> POST /direct/:id/pay {rawTx} against a running AgentTab server (which broadcasts it).
//   AGENTTAB_API=http://127.0.0.1:8402 node packages/covenant/scripts/direct-pay-e2e.ts ["question"]
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { placeholderP2PKHUnlocker } from 'cashscript';
import { binToHex, cashAddressToLockingBytecode, stringify } from '@bitauth/libauth';
import { initiateDappRelay } from '@wizardconnect/core';
import { DappConnectionManager } from '@wizardconnect/dapp';
import { buildDirectPay, electrumProvider, p2pkhAddress } from '../src/index.ts';

const API = (process.env.AGENTTAB_API ?? 'http://127.0.0.1:8402').replace(/\/$/, '');
const q = process.argv[2] ?? 'What is BCH trading at?';
const quiet = console.log.bind(console);
console.log = (...a: unknown[]) => { if (typeof a[0] === 'string' && a[0].startsWith('[relay]')) return; quiet(...a); };

const info = await (await fetch(`${API}/.well-known/agenttab`)).json();
if (info.network !== 'chipnet') throw new Error(`refusing: server network is ${info.network}, this script is chipnet-only`);

const manager = new DappConnectionManager('AgentTab direct-pay e2e', undefined, { session: false });
const dapp = initiateDappRelay((p) => manager.updateConnection(p.client, p.status));
const child = spawn(process.execPath, [fileURLToPath(new URL('./wc-test-wallet.ts', import.meta.url)), dapp.uri], { stdio: ['ignore', 'pipe', 'inherit'] });
child.stdout.on('data', (d) => process.stdout.write(String(d).split('\n').filter(Boolean).map((l) => `  [wallet] ${l}\n`).join('')));
const done = (code: number) => { child.kill('SIGINT'); dapp.cleanup(); setTimeout(() => process.exit(code), 1500); };
setTimeout(() => { console.error('FAIL: timed out'); done(1); }, 180_000).unref();

await new Promise<void>((r) => manager.once('walletready', () => r()));
const chain = electrumProvider('chipnet');
const addrs: { address: string; path: [string, number] }[] = [];
for (const [child, name, n] of [[0, 'receive', 10], [1, 'change', 5]] as const) {
  for (let i = 0; i < n; i++) { const k = manager.getPubkey(child, BigInt(i)); if (k) addrs.push({ address: p2pkhAddress(k, 'chipnet'), path: [name, i] }); }
}
const lb = (a: string) => { const r = cashAddressToLockingBytecode(a); if (typeof r === 'string') throw new Error(r); return binToHex(r.bytecode); };
const byLb = new Map(addrs.map((a) => [lb(a.address), a]));
const utxos = (await Promise.all(addrs.map((a) => chain.getUtxos(a.address)))).flat().filter((u) => !u.token);
console.log(`wallet ${addrs[0].address}: ${utxos.reduce((s, u) => s + u.satoshis, 0n)} sats`);

const inv = await (await fetch(`${API}/direct`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ q }) })).json();
console.log(`invoice ${inv.invoiceId}: ${inv.amountSats} sats to ${inv.payTo}, OP_RETURN ${JSON.stringify(inv.opReturn)}`);
const { builder, inputs } = buildDirectPay({
  provider: chain, payTo: inv.payTo, amount: BigInt(inv.amountSats), invoiceId: inv.invoiceId, fundingUtxos: utxos,
  changeAddress: addrs[0].address, unlockerFor: (u) => placeholderP2PKHUnlocker(byLb.get(u.lockingBytecode)!.address),
});
const wc = builder.generateWcTransactionObject({ broadcast: false, userPrompt: `Pay ${inv.amountSats} sats for one AgentTab oracle answer` });
const inputPaths = inputs.map((u, i) => [i, ...byLb.get(u.lockingBytecode)!.path] as [number, string, number]);
const res = await manager.signTransaction({ transaction: JSON.parse(stringify(wc)), inputPaths });
if (res.error || !res.signedTransaction) { console.error(`FAIL: wallet did not sign: ${res.error}`); done(1); }
console.log(`wallet signed ${res.signedTransaction.length / 2} bytes`);
const r = await fetch(`${API}/direct/${inv.invoiceId}/pay`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rawTx: res.signedTransaction }) });
const body = await r.json();
console.log(`pay -> ${r.status}`, JSON.stringify(body));
const replay = await fetch(`${API}/direct`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ q }) }).then((x) => x.json());
const rp = await fetch(`${API}/direct/${replay.invoiceId}/pay`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ txid: body.txid }) });
console.log(`replay of the same txid on a new invoice -> ${rp.status} ${(await rp.json()).error}`);
if (r.status === 200 && rp.status === 409) { console.log(`PASS: chipnet txid ${body.txid}`); done(0); } else done(1);
