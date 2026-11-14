// Generates THROWAWAY chipnet keys into ./.env (gitignored). Never use for mainnet.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { encodePrivateKeyWif, generatePrivateKey } from '@bitauth/libauth';
import { p2pkhAddress, pubFromPriv } from '../src/index.ts';

const path = new URL('../../../.env', import.meta.url);
// Appends any missing role keys; never overwrites existing ones.
const existing = existsSync(path) ? readFileSync(path, 'utf8') : '# THROWAWAY CHIPNET KEYS - test coins only, never mainnet\n';
const lines = [existing.trimEnd()];
for (const role of ['OWNER', 'AGENT', 'PROVIDER']) {
  if (existing.includes(`${role}_WIF=`)) continue;
  const priv = generatePrivateKey();
  lines.push(`${role}_WIF=${encodePrivateKeyWif(priv, 'testnet')}`);
  console.log(role, p2pkhAddress(pubFromPriv(priv), 'chipnet'));
}
writeFileSync(path, lines.join('\n') + '\n', { mode: 0o600 });
