import { readFileSync, existsSync } from 'node:fs';
import { decodePrivateKeyWif, encodePrivateKeyWif, sha256, secp256k1, utf8ToBin } from '@bitauth/libauth';

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

export type ChainNetwork = 'chipnet' | 'mainnet';

/** NETWORK=chipnet (default) | mainnet. Mainnet additionally requires ALLOW_MAINNET=1. */
export function resolveNetwork(env: Record<string, string | undefined>): ChainNetwork {
  const n = (env.NETWORK ?? 'chipnet').toLowerCase();
  if (n === 'chipnet') return 'chipnet';
  if (n === 'mainnet') {
    if (env.ALLOW_MAINNET !== '1') throw new Error('NETWORK=mainnet refused: set ALLOW_MAINNET=1 explicitly');
    return 'mainnet';
  }
  throw new Error(`unknown NETWORK ${n}`);
}

/** Decodes a WIF and checks it matches the network (testnet WIF for chipnet, mainnet WIF for mainnet). */
export function networkKey(wif: string | undefined, name: string, network: ChainNetwork = 'chipnet'): Uint8Array {
  if (!wif) throw new Error(`${name} missing (run: node packages/covenant/scripts/keygen.ts)`);
  const d = decodePrivateKeyWif(wif);
  if (typeof d === 'string') throw new Error(`${name}: ${d}`);
  const want = network === 'mainnet' ? 'mainnet' : 'testnet';
  if (d.type !== want) throw new Error(`${name}: expected a ${want} WIF for ${network}`);
  return d.privateKey;
}

export const testnetKey = (wif: string | undefined, name: string) => networkKey(wif, name, 'chipnet');

const SEEDED = ['PROVIDER_WIF', 'DEMO_AGENT_WIF', 'FAUCET_WIF', 'ATTACK_OWNER_WIF'] as const;

/**
 * Hosted deploys: if KEY_SEED is set (e.g. Render `generateValue: true`), any of the role WIFs that are not set
 * explicitly are derived as sha256("agenttab:<network>:<ROLE>:<seed>"), so no private key is ever typed into a
 * dashboard and keys survive restarts. Explicit *_WIF env vars always win.
 */
export function withSeedKeys(env: Record<string, string | undefined>, network: ChainNetwork) {
  const seed = env.KEY_SEED;
  if (!seed) return env;
  const out = { ...env };
  for (const role of SEEDED) {
    if (out[role]) continue;
    let priv = sha256.hash(utf8ToBin(`agenttab:${network}:${role}:${seed}`));
    while (!secp256k1.validatePrivateKey(priv)) priv = sha256.hash(priv);
    out[role] = encodePrivateKeyWif(priv, network === 'mainnet' ? 'mainnet' : 'testnet');
  }
  return out;
}
