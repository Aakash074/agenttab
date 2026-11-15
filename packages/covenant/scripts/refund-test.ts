// CHIPNET: open the shortest-lived tab the hosted provider accepts, then (later) refund it as the owner.
//
//   node packages/covenant/scripts/refund-test.ts                 # open + register with the hosted API
//   node packages/covenant/scripts/refund-test.ts --no-register   # open against the hosted provider key, don't register
//   node packages/covenant/scripts/refund-test.ts --refund        # owner refund once the timeout has passed
//   node packages/covenant/scripts/refund-test.ts --refund --wait # ...polling the chain until it is valid
//   (add --no-register to --refund as well to act on the unregistered tab)
//   options: --budget <sats> (default 5000)   env: AGENTTAB_API (default the hosted chipnet API)
//
// Uses OWNER_WIF from ./.env (must be a testnet WIF). State goes to .data/refund-test.json.
//
// Server rules (packages/server/src/ledger.ts): register() rejects a tab unless tip + SAFETY_BLOCKS < timeout,
// so the shortest accepted timeout is tip + SAFETY_BLOCKS + 1 (hosted: safetyBlocks = 6 -> tip + 7).
// NOTE: the provider's tick() then auto-closes any registered tab once tip + SAFETY_BLOCKS >= timeout,
// i.e. about one block after opening; with no vouchers it CANCELS (whole budget minus fee back to the
// owner). So for a registered tab the owner refund normally finds the utxo already spent by that cancel.
// Use --no-register to exercise the owner-refund path itself (same provider key, server unaware).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { decodePrivateKeyWif, generatePrivateKey, hexToBin } from '@bitauth/libauth';
import { binToHex, buildOpen, buildRefund, electrumProvider, p2pkhAddress, pubFromPriv, tabContract } from '../src/index.ts';

const root = new URL('../../../', import.meta.url);
const API = (process.env.AGENTTAB_API ?? 'https://agenttab-api-chipnet.onrender.com').replace(/\/$/, '');
const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
// Registered and unregistered test tabs keep separate state, so both can be in flight at once.
const stateFile = new URL(`.data/refund-test${flag('--no-register') ? '-unregistered' : ''}.json`, root);
const opt = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const link = (txid: string) => `https://chipnet.imaginary.cash/tx/${txid}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const env = readFileSync(new URL('.env', root), 'utf8');
const wifMatch = env.match(/^OWNER_WIF=(\S+)$/m);
if (!wifMatch) throw new Error('OWNER_WIF missing from .env');
const dec = decodePrivateKeyWif(wifMatch[1]);
if (typeof dec === 'string') throw new Error(dec);
if (dec.type !== 'testnet') throw new Error('OWNER_WIF is not a testnet key; refusing (chipnet only)');
const ownerPriv = dec.privateKey;
const ownerPub = pubFromPriv(ownerPriv);
const ownerAddr = p2pkhAddress(ownerPub, 'chipnet');
const net = electrumProvider('chipnet');

async function api<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const r = await fetch(API + path, { ...init, signal: AbortSignal.timeout(90_000) });
  return { status: r.status, body: await r.json().catch(() => ({})) as T };
}

interface State {
  network: 'chipnet'; api: string; txid: string; vout: number; timeout: number; budget: string;
  ownerPub: string; agentPub: string; providerPub: string; contract: string; registered: boolean; openedAtTip: number;
}

if (!flag('--refund')) {
  const { body: info } = await api<{ providerPub: string; network: string; safetyBlocks: number; tip: number }>('/.well-known/agenttab');
  if (info.network !== 'chipnet') throw new Error(`API network is ${info.network}; refusing (chipnet only)`);
  const tip = Math.max(await net.getBlockHeight(), info.tip);
  const timeout = tip + info.safetyBlocks + 1;
  const budget = BigInt(opt('--budget') ?? 5000);
  // Throwaway agent key: this test never pays for calls.
  const agentPub = pubFromPriv(generatePrivateKey());
  const providerPub = hexToBin(info.providerPub);
  const contract = tabContract({ ownerPub, agentPub, providerPub, timeout: BigInt(timeout) }, net);
  const funding = (await net.getUtxos(ownerAddr)).filter((u) => !u.token);
  console.log(`owner ${ownerAddr} (${funding.reduce((s, u) => s + u.satoshis, 0n)} sats)`);
  console.log(`provider ${info.providerPub}  safetyBlocks ${info.safetyBlocks}  tip ${tip}`);
  console.log(`shortest accepted timeout = tip + ${info.safetyBlocks} + 1 = ${timeout}`);
  const tx = await buildOpen({ provider: net, contract, payerPriv: ownerPriv, fundingUtxos: funding, budget, changeAddress: ownerAddr }).send();
  console.log(`opened tab ${tx.txid}:0  budget ${budget} sats  contract ${contract.address}\n  ${link(tx.txid)}`);

  let registered = false;
  if (!flag('--no-register')) {
    for (let attempt = 1; attempt <= 6 && !registered; attempt++) {
      const r = await api<{ error?: string; message?: string; id?: string }>('/tabs', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ txid: tx.txid, vout: 0, ownerPub: binToHex(ownerPub), agentPub: binToHex(agentPub), timeout }),
      });
      if (r.status === 201) { registered = true; console.log(`registered with ${API} as ${r.body.id}`); break; }
      console.log(`register attempt ${attempt}: ${r.status} ${r.body.error ?? ''} ${r.body.message ?? ''}`);
      if (r.body.error !== 'tab_not_found') break; // only the mempool-propagation race is worth retrying
      await sleep(5000);
    }
    if (registered) console.log(`heads-up: the provider auto-cancels this tab (full budget minus fee back to ${ownerAddr}) once tip >= ${timeout - info.safetyBlocks}, i.e. ~1 block from now, before the owner refund unlocks.`);
  }
  const state: State = {
    network: 'chipnet', api: API, txid: tx.txid, vout: 0, timeout, budget: budget.toString(), ownerPub: binToHex(ownerPub),
    agentPub: binToHex(agentPub), providerPub: info.providerPub, contract: contract.address, registered, openedAtTip: tip,
  };
  mkdirSync(new URL('.data/', root), { recursive: true });
  writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n');
  console.log(`refund becomes valid when the chain tip reaches block ${timeout} (nLockTime ${timeout}; first includable in block ${timeout + 1}), ~${timeout - tip} blocks / ~${(timeout - tip) * 10} min.`);
  console.log(`then run: node packages/covenant/scripts/refund-test.ts --refund${registered ? '' : ' --no-register'}   (state: ${stateFile.pathname})`);
  process.exit(0);
}

// ---------- --refund ----------
if (!existsSync(stateFile)) throw new Error(`no ${stateFile.pathname}; open a tab first`);
const s: State = JSON.parse(readFileSync(stateFile, 'utf8'));
if (s.network !== 'chipnet') throw new Error('state is not chipnet; refusing');
if (s.ownerPub !== binToHex(ownerPub)) throw new Error('OWNER_WIF in .env does not match the key that opened this tab');
const contract = tabContract({ ownerPub, agentPub: hexToBin(s.agentPub), providerPub: hexToBin(s.providerPub), timeout: BigInt(s.timeout) }, net);
console.log(`tab ${s.txid}:${s.vout}  timeout ${s.timeout}  contract ${s.contract}  registered=${s.registered}`);

for (;;) {
  const tip = await net.getBlockHeight();
  const utxo = (await contract.getUtxos()).find((u) => u.txid === s.txid && u.vout === s.vout);
  if (!utxo) {
    console.log('tab utxo is already spent.');
    if (s.registered) {
      const { body } = await api<{ status?: string; settledTxid?: string }>(`/tabs/${s.txid}:${s.vout}`);
      console.log(`server says status=${body.status ?? 'unknown'}${body.settledTxid ? ` closing tx ${body.settledTxid}\n  ${link(body.settledTxid)}` : ''}`);
      if (body.status === 'cancelled') console.log('(expected: the provider auto-cancelled inside its safety window; the owner already got the budget back minus the fee)');
    }
    process.exit(0);
  }
  if (tip >= s.timeout) {
    const tx = await buildRefund({ provider: net, contract, tabUtxo: utxo, ownerPriv, timeout: BigInt(s.timeout), network: 'chipnet' }).send();
    console.log(`owner refund at tip ${tip}: ${tx.txid}  (${utxo.satoshis} sats back to ${ownerAddr} minus fee)\n  ${link(tx.txid)}`);
    process.exit(0);
  }
  console.log(`tip ${tip} < timeout ${s.timeout}: refund not valid yet (${s.timeout - tip} block(s) to go).`);
  if (!flag('--wait')) process.exit(1);
  await sleep(30_000);
}
