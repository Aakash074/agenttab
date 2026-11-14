import { readFileSync, existsSync } from 'node:fs';
import { decodePrivateKeyWif } from '@bitauth/libauth';

export const repoRoot = new URL('../../../', import.meta.url);

/** Loads ./.env (gitignored) into a plain object, process.env taking precedence. */
export function loadEnv(): Record<string, string | undefined> {
  const file = new URL('.env', repoRoot);
  const fromFile = existsSync(file)
    ? Object.fromEntries(readFileSync(file, 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
      .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }))
    : {};
  return { ...fromFile, ...process.env };
}

export function testnetKey(wif: string | undefined, name: string): Uint8Array {
  if (!wif) throw new Error(`${name} missing (run: node packages/covenant/scripts/keygen.ts)`);
  const d = decodePrivateKeyWif(wif);
  if (typeof d === 'string') throw new Error(`${name}: ${d}`);
  if (d.type !== 'testnet') throw new Error(`${name}: refusing non-testnet key`);
  return d.privateKey;
}
