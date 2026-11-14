// End-to-end AgentTab run on CHIPNET (testnet) with throwaway keys from ./.env.
//   Tab A: open -> 3 cumulative vouchers -> provider settles the highest.
//   Tab B: open with timeout = height+1 -> early refund rejected by the network -> wait -> refund.
// Usage: node packages/covenant/scripts/chipnet-demo.ts
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { ElectrumNetworkProvider } from 'cashscript';
import { decodePrivateKeyWif } from '@bitauth/libauth';
import {
  buildOpen, buildRefund, buildSettle, p2pkhAddress, pubFromPriv, signVoucher, tabContract, verifyVoucher,
} from '../src/index.ts';

const root = new URL('../../../', import.meta.url);
const env = Object.fromEntries(
  readFileSync(new URL('.env', root), 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => l.split('=', 2) as [string, string]),
);
const wif = (w: string) => {
  const d = decodePrivateKeyWif(w);
  if (typeof d === 'string') throw new Error(d);
  if (d.type !== 'testnet') throw new Error('refusing non-testnet key');
  return d.privateKey;
};
const ownerPriv = wif(env.OWNER_WIF), providerPriv = wif(env.PROVIDER_WIF);
const ownerPub = pubFromPriv(ownerPriv), providerPub = pubFromPriv(providerPriv);
const ownerAddr = p2pkhAddress(ownerPub, 'chipnet');
const net = new ElectrumNetworkProvider('chipnet');

const log: string[] = [];
const out = (s: string) => { console.log(s); log.push(s); };
const link = (txid: string) => `https://chipnet.imaginary.cash/tx/${txid}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
mkdirSync(new URL('.data/', root), { recursive: true });
const save = () => writeFileSync(new URL('.data/chipnet-run.md', root), log.join('\n') + '\n');

async function openTab(timeout: bigint, budget: bigint) {
  const contract = tabContract({ ownerPub, providerPub, timeout }, net);
  const funding = await net.getUtxos(ownerAddr);
  if (!funding.length) throw new Error(`no utxos at ${ownerAddr}; fund it from a chipnet faucet`);
  const tx = await buildOpen({ provider: net, contract, ownerPriv, fundingUtxos: funding, budget, changeAddress: ownerAddr }).send();
  const tab = (await contract.getUtxos()).find((u) => u.txid === tx.txid);
  if (!tab) throw new Error('tab utxo not found after open');
  return { contract, tab, txid: tx.txid };
}

const height = await net.getBlockHeight();
out(`# chipnet run ${new Date().toISOString()} (height ${height})`);
out(`owner ${ownerAddr}\nprovider ${p2pkhAddress(providerPub, 'chipnet')}`);

// ---- Tab A: open -> 3 vouchers -> settle ----
const A = await openTab(BigInt(height + 1000), 20_000n);
out(`\n## Tab A (timeout height ${height + 1000})\ncontract ${A.contract.address}\nopen ${A.txid} ${link(A.txid)}`);
const PRICE = 1000n;
let voucher;
for (let call = 1n; call <= 3n; call++) {
  voucher = signVoucher(ownerPriv, A.tab, PRICE * call);
  if (!verifyVoucher(ownerPub, voucher)) throw new Error('voucher verify failed');
  out(`voucher #${call}: amount=${voucher.amount} sig=${voucher.sig.slice(0, 16)}…`);
}
// Negative check on the real network: provider tries to settle with voucher #3 but pays itself more.
try {
  const bad = buildSettle({ provider: net, contract: A.contract, tabUtxo: A.tab, providerPriv, ownerPub, voucher: { ...voucher!, amount: 9000n } });
  await bad.send();
  out('!! overclaim unexpectedly accepted');
} catch (e) { out(`overclaim (amount 9000 with voucher for 3000) rejected: ${(e as Error).message.split('\n')[0].slice(0, 120)}`); }
const settle = await buildSettle({ provider: net, contract: A.contract, tabUtxo: A.tab, providerPriv, ownerPub, voucher: voucher! }).send();
out(`settle (voucher #3 = 3000 sats) ${settle.txid} ${link(settle.txid)}`);
save();

// ---- Tab B: refund after timeout ----
const h2 = await net.getBlockHeight();
const timeoutB = BigInt(h2 + 1);
const B = await openTab(timeoutB, 10_000n);
out(`\n## Tab B (timeout height ${timeoutB})\ncontract ${B.contract.address}\nopen ${B.txid} ${link(B.txid)}`);
const refund = () => buildRefund({ provider: net, contract: B.contract, tabUtxo: B.tab, ownerPriv, timeout: timeoutB }).send();
try {
  const r = await refund();
  out(`!! early refund unexpectedly accepted ${r.txid}`);
} catch (e) { out(`early refund at height ${h2} rejected by node: ${(e as Error).message.split('\n')[0].slice(0, 160)}`); }
save();
for (;;) {
  const h = await net.getBlockHeight();
  if (h >= Number(timeoutB)) break;
  console.log(`waiting for height ${timeoutB} (now ${h})…`);
  await sleep(30_000);
}
const r = await refund();
out(`refund after timeout (height ${await net.getBlockHeight()}) ${r.txid} ${link(r.txid)}`);
save();
process.exit(0);
