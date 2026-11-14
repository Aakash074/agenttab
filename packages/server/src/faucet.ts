// CHIPNET-ONLY drip: tops a visitor's browser test wallet up with free test sats so they can fund a tab
// in seconds. A wallet can get coins again whenever its on-chain balance is below `refillBelowSats`
// (no "once per day" dead end), with per-address / per-IP / global rate limits. The faucet key itself is
// topped up from the public BCH Ninja chipnet faucet (proof-of-work, free test coins) when it runs low.
// Refuses to construct on any network other than chipnet/mocknet.
import { createHash } from 'node:crypto';
import { SignatureTemplate, TransactionBuilder, type NetworkProvider } from 'cashscript';
import { decodeCashAddress } from '@bitauth/libauth';
import { p2pkhAddress, pubFromPriv } from '@agenttab/covenant';
import { json, readBody, type ExtraHandler } from './app.ts';
import { RateLimiter, clientIp } from './ratelimit.ts';

export interface FaucetOptions {
  network: string;
  provider: NetworkProvider;
  faucetPriv: Uint8Array;
  dripSats: bigint;
  /** A wallet may drip again while its balance is below this. */
  refillBelowSats?: bigint;
  trustProxy?: boolean;
  /** Auto top-up from the public chipnet faucet when our balance drops below this (0 = off). */
  topUpBelowSats?: bigint;
  topUpSats?: bigint;
  fetchImpl?: typeof fetch;
  limits?: { perIp?: [number, number]; perAddress?: [number, number]; global?: [number, number] };
}

/** Requests free chipnet coins from https://chipnet.bch.ninja (solves its small proof-of-work like the website does). */
export async function publicChipnetFaucet(address: string, sats: bigint, f: typeof fetch = fetch): Promise<string> {
  const base = 'https://chipnet.bch.ninja/api/';
  const post = async (path: string, body: unknown) => {
    const r = await f(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
    const t = await r.text();
    if (!r.ok) throw new Error(`public faucet ${path}: ${r.status} ${t.slice(0, 200)}`);
    return JSON.parse(t);
  };
  const ch = await post('challenge', { address, sats: sats.toString() });
  const target = BigInt(`0x${ch.target}`);
  let nonce = 0n;
  for (;;) {
    const d = createHash('sha256').update(`${ch.payload}:${nonce}`).digest('hex');
    if (BigInt(`0x${d}`) <= target) break;
    nonce++;
    if (nonce % 200_000n === 0n) await new Promise((r) => setImmediate(r)); // stay responsive
  }
  const res = await post('claim', { payload: ch.payload, signature: ch.signature, nonce: nonce.toString() });
  return res.txid as string;
}

export function createFaucet(o: FaucetOptions) {
  if (o.network !== 'chipnet' && o.network !== 'mocknet') throw new Error('faucet drip is chipnet-only');
  const address = p2pkhAddress(pubFromPriv(o.faucetPriv), 'chipnet');
  const refillBelow = o.refillBelowSats ?? 6_000n;
  const l = o.limits ?? {};
  const perIp = new RateLimiter(...(l.perIp ?? [6, 60 * 60_000]));
  const perAddress = new RateLimiter(...(l.perAddress ?? [3, 60 * 60_000]));
  const global = new RateLimiter(...(l.global ?? [60, 60 * 60_000]));
  let busy: Promise<unknown> = Promise.resolve();
  let lastTopUp = 0;
  let lastTopUpTxid: string | undefined;

  const balanceOf = async (a: string) => (await o.provider.getUtxos(a)).filter((u) => !u.token).reduce((s, u) => s + u.satoshis, 0n);

  async function maybeTopUp() {
    const below = o.topUpBelowSats ?? 0n;
    if (below <= 0n || o.network !== 'chipnet' || Date.now() - lastTopUp < 30 * 60_000) return;
    if ((await balanceOf(address)) >= below) return;
    lastTopUp = Date.now();
    try {
      lastTopUpTxid = await publicChipnetFaucet(address, o.topUpSats ?? 500_000n, o.fetchImpl);
      console.log('faucet topped up from public chipnet faucet', lastTopUpTxid);
    } catch (e) { console.error('faucet top-up failed', (e as Error).message); }
  }

  async function drip(to: string) {
    const run = busy.then(async () => {
      const utxos = (await o.provider.getUtxos(address)).filter((u) => !u.token);
      const b = new TransactionBuilder({ provider: o.provider })
        .addInputs(utxos, new SignatureTemplate(o.faucetPriv).unlockP2PKH())
        .addOutput({ to, amount: o.dripSats });
      b.addBchChangeOutputIfNeeded({ to: address, feeRate: 1 });
      return (await b.send()).txid;
    });
    busy = run.catch(() => {});
    return run;
  }

  const handler: ExtraHandler = async (req, res, url) => {
    if (url.pathname === '/faucet' && req.method === 'GET') {
      json(res, 200, {
        enabled: true, network: 'chipnet', dripSats: o.dripSats.toString(), refillBelowSats: refillBelow.toString(),
        address, balanceSats: (await balanceOf(address).catch(() => 0n)).toString(), lastTopUpTxid,
      });
      return true;
    }
    if (url.pathname !== '/faucet/drip' || req.method !== 'POST') return false;
    const body = await readBody(req).catch(() => ({}));
    const to = String(body.address ?? '');
    const dec = decodeCashAddress(to);
    if (typeof dec === 'string' || dec.prefix !== 'bchtest' || dec.type !== 'p2pkh') {
      json(res, 400, { error: 'bad_address', message: 'a chipnet P2PKH address (bchtest:q…) is required' });
      return true;
    }
    const has = await balanceOf(to).catch(() => 0n);
    if (has >= refillBelow) {
      json(res, 409, { error: 'already_funded', message: `This wallet already has ${has} sats, enough to open a tab.` });
      return true;
    }
    const wait = perAddress.take(to) || perIp.take(clientIp(req, !!o.trustProxy)) || global.take('all');
    if (wait) {
      json(res, 429, { error: 'rate_limited', message: `Test-coin limit reached. Try again in ${Math.ceil(wait / 60_000)} min.`, retryInMs: wait });
      return true;
    }
    try {
      json(res, 200, { txid: await drip(to), sats: o.dripSats.toString() });
    } catch (e) {
      json(res, 503, { error: 'faucet_failed', message: (e as Error).message });
    } finally {
      maybeTopUp().catch(() => {});
    }
    return true;
  };

  return { address, handler, drip, balance: () => balanceOf(address), maybeTopUp };
}
