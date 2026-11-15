import { chainLockTip, electrumProvider } from '@agenttab/covenant';
// Agent-side demo against a running paywall server on chipnet:
// hit 402 -> open tab on chain -> register -> 3 paid calls (one voucher each) -> replay attempt -> ask server to settle.
import { ElectrumNetworkProvider } from 'cashscript';
import { binToHex, buildOpen, hexToBin, p2pkhAddress, pubFromPriv, signVoucher, tabContract } from '@agenttab/covenant';
import { encodePaymentHeader } from '../src/app.ts';
import { loadEnv, testnetKey } from '../src/env.ts';

const env = loadEnv();
const base = env.SERVER_URL ?? 'http://localhost:8402';
const ownerPriv = testnetKey(env.OWNER_WIF, 'OWNER_WIF'), agentPriv = testnetKey(env.AGENT_WIF, 'AGENT_WIF');
const ownerPub = pubFromPriv(ownerPriv), agentPub = pubFromPriv(agentPriv);
const net = electrumProvider('chipnet');
const link = (t: string) => `https://chipnet.imaginary.cash/tx/${t}`;

const first = await fetch(`${base}/api/oracle?q=hello`);
const terms = (await first.json()).accepts[0];
console.log(`402 -> scheme=${terms.scheme} price=${terms.maxAmountRequired} payTo=${terms.payTo.slice(0, 16)}…`);

const timeout = BigInt((await chainLockTip(net, 'chipnet')) + 144); // nLockTime units
const contract = tabContract({ ownerPub, agentPub, providerPub: hexToBin(terms.payTo), timeout }, net);
const ownerAddr = p2pkhAddress(ownerPub, 'chipnet');
const open = await buildOpen({ provider: net, contract, payerPriv: ownerPriv, fundingUtxos: await net.getUtxos(ownerAddr), budget: 20_000n, changeAddress: ownerAddr }).send();
console.log(`open tab ${open.txid} ${link(open.txid)}`);
const outpoint = { txid: open.txid, vout: 0 };
const reg = await fetch(`${base}/tabs`, { method: 'POST', body: JSON.stringify({ ...outpoint, ownerPub: binToHex(ownerPub), agentPub: binToHex(agentPub), timeout: timeout.toString() }) });
console.log('register', reg.status, (await reg.json()).contractAddress);

const price = BigInt(terms.maxAmountRequired);
let last = '';
for (let i = 1n; i <= 3n; i++) {
  const v = signVoucher(agentPriv, outpoint, price * i);
  last = encodePaymentHeader('chipnet', { tab: `${open.txid}:0`, amount: v.amount, sig: v.sig });
  const r = await fetch(`${base}/api/oracle?q=call${i}`, { headers: { 'x-payment': last } });
  console.log(`call ${i}: ${r.status} voucher=${v.amount}`, (await r.json()).answer?.slice(0, 50));
}
const replay = await fetch(`${base}/api/oracle?q=replay`, { headers: { 'x-payment': last } });
console.log('replay of voucher #3:', replay.status, (await replay.json()).error);
const s = await fetch(`${base}/tabs/${open.txid}:0/settle`, { method: 'POST', headers: env.ADMIN_TOKEN ? { authorization: `Bearer ${env.ADMIN_TOKEN}` } : {} });
const { txid } = await s.json();
console.log(`server settled ${txid} ${link(txid)}`);
process.exit(0);
