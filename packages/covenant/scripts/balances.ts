// CHIPNET helper: print balances of the local .env role keys, plus any extra addresses/pubkeys given as args.
import { readFileSync } from 'node:fs';
import { decodePrivateKeyWif, hexToBin } from '@bitauth/libauth';
import { electrumProvider, p2pkhAddress, pubFromPriv } from '../src/index.ts';
const net = electrumProvider('chipnet');
const env = readFileSync(new URL('../../../.env', import.meta.url), 'utf8');
const bal = async (a: string) => (await net.getUtxos(a)).filter((u) => !u.token).reduce((s, u) => s + u.satoshis, 0n);
for (const k of ['OWNER_WIF', 'FAUCET_WIF', 'DEMO_AGENT_WIF', 'ATTACK_OWNER_WIF']) {
  const m = env.match(new RegExp(`^${k}=(\\S+)$`, 'm')); if (!m) continue;
  const d = decodePrivateKeyWif(m[1]); if (typeof d === 'string') continue;
  const a = p2pkhAddress(pubFromPriv(d.privateKey), 'chipnet'); console.log(k, a, await bal(a));
}
for (const x of process.argv.slice(2)) {
  const a = x.startsWith('bchtest:') ? x : p2pkhAddress(hexToBin(x), 'chipnet'); console.log('arg', a, await bal(a));
}
process.exit(0);
