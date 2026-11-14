// Prints the public keys/addresses for the keys in ./.env (never prints private keys).
import { readFileSync } from 'node:fs';
import { binToHex, decodePrivateKeyWif } from '@bitauth/libauth';
import { p2pkhAddress, pubFromPriv } from '../src/index.ts';
const env = readFileSync(new URL('../../../.env', import.meta.url), 'utf8');
for (const m of env.matchAll(/^(\w+)_WIF=(\S+)$/gm)) {
  const d = decodePrivateKeyWif(m[2]);
  if (typeof d === 'string') continue;
  const pub = pubFromPriv(d.privateKey);
  console.log(`${m[1]}_PUB=${binToHex(pub)}  ${p2pkhAddress(pub, d.type === 'mainnet' ? 'mainnet' : 'chipnet')}`);
}
