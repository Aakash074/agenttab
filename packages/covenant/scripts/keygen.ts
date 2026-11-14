// Generates THROWAWAY chipnet keys into ./.env (gitignored). Never use for mainnet.
import { existsSync, writeFileSync } from 'node:fs';
import { encodePrivateKeyWif, generatePrivateKey } from '@bitauth/libauth';
import { p2pkhAddress, pubFromPriv } from '../src/index.ts';

const path = new URL('../../../.env', import.meta.url);
if (existsSync(path)) { console.log('.env exists, not overwriting'); process.exit(0); }
const lines = ['# THROWAWAY CHIPNET KEYS - test coins only, never mainnet'];
for (const role of ['OWNER', 'PROVIDER']) {
  const priv = generatePrivateKey();
  lines.push(`${role}_WIF=${encodePrivateKeyWif(priv, 'testnet')}`);
  console.log(role, p2pkhAddress(pubFromPriv(priv), 'chipnet'));
}
writeFileSync(path, lines.join('\n') + '\n', { mode: 0o600 });
