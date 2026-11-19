// CHIPNET-ONLY drip: tops a visitor's browser test wallet up with free test sats so they can fund a tab
// in seconds. A wallet can get coins again whenever its on-chain balance is below `refillBelowSats`
// (no "once per day" dead end), with per-address / per-IP / global rate limits. The faucet key itself is
// topped up from the public BCH Ninja chipnet faucet (proof-of-work, free test coins) when it runs low.
// Refuses to construct on any network other than chipnet/mocknet.
import { createHash } from 'node:crypto';
import { SignatureTemplate, TransactionBuilder, type NetworkProvider, type SpendableUtxo as Utxo } from 'cashscript';
import { binToHex, decodeCashAddress, decodeTransaction, hexToBin } from '@bitauth/libauth';
import { p2pkhAddress, pubFromPriv } from '@agenttab/covenant';
import { json, readBody, type ExtraHandler } from './app.ts';
import { RateLimiter, clientIp, takeAll } from './ratelimit.ts';

export interface FaucetOptions {
  network: string;
  provider: NetworkProvider;
  /**
   * Second electrum server, read-only. The public chipnet faucet (chipnet.bch.ninja) answers top-ups from its
   * own node, which does not relay: those coins sit in that one mempool and our primary server never sees them.
   * Coins seen only here are relayed (with any unconfirmed ancestors) to the primary before we count or spend them.
   */
  mirror?: Pick<NetworkProvider, 'getUtxos' | 'getRawTransaction'>;
  faucetPriv: Uint8Array;
  dripSats: bigint;
  /** A wallet may drip again while its balance is below this. */
  refillBelowSats?: bigint;
  trustProxy?: boolean;
  /** Auto top-up from the public chipnet faucet when our balance drops below this (0 = off; never below 4 drips). */
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

type TxReader = Pick<NetworkProvider, 'getRawTransaction'>;
type TxRelay = Pick<NetworkProvider, 'getRawTransaction' | 'sendRawTransaction'>;
const known = (p: TxReader, txid: string) => p.getRawTransaction(txid).then(() => true, () => false);

/**
 * Copies `txid` and every unconfirmed ancestor that `to` has not seen from `from` to `to`, parents first.
 * Returns how many transactions were broadcast. Throws if any of them is refused.
 */
export async function relayTx(from: TxReader, to: TxRelay, txid: string, maxTxs = 60): Promise<number> {
  const order: string[] = [];
  const seen = new Set<string>();
  const visit = async (id: string): Promise<void> => {
    if (seen.has(id)) return;
    seen.add(id);
    if (await known(to, id)) return;
    if (seen.size > maxTxs) throw new Error(`relay ${txid}: more than ${maxTxs} missing ancestors`);
    const raw = await from.getRawTransaction(id);
    const tx = decodeTransaction(hexToBin(raw));
    if (typeof tx === 'string') throw new Error(`relay ${id}: ${tx}`);
    for (const i of tx.inputs) await visit(binToHex(i.outpointTransactionHash));
    order.push(raw);
  };
  await visit(txid);
  for (const raw of order) {
    try { await to.sendRawTransaction(raw); }
    catch (e) { if (!/already|known|in mempool/i.test((e as Error).message)) throw e; }
  }
  return order.length;
}

/** Coin-selection order and the minimum a drip needs (1 sat/byte: a few inputs + 2 outputs stay well under this). */
export const DRIP_FEE_ROOM = 1_000n;

/**
 * The faucet's spendable BCH coins: everything the primary server sees, plus coins only the mirror sees once they
 * have been relayed to the primary (otherwise a drip spending them would be refused as "missing inputs").
 * `pendingSats` counts mirror-only coins that could not be relayed (yet).
 */
export async function faucetCoins(
  primary: Pick<NetworkProvider, 'getUtxos' | 'getRawTransaction' | 'sendRawTransaction'>, address: string,
  mirror?: Pick<NetworkProvider, 'getUtxos' | 'getRawTransaction'>, relayed = new Map<string, boolean | number>(),
): Promise<{ utxos: Utxo[]; sats: bigint; pendingSats: bigint }> {
  const bch = (u: Utxo[]) => u.filter((x) => !x.token);
  const [mine, theirs] = await Promise.all([primary.getUtxos(address).then(bch), mirror ? mirror.getUtxos(address).then(bch).catch(() => []) : []]);
  const key = (u: Utxo) => `${u.txid}:${u.vout}`;
  const have = new Set(mine.map(key));
  const utxos = [...mine];
  let pendingSats = 0n;
  for (const u of theirs) {
    if (have.has(key(u))) continue;
    const r = relayed.get(u.txid);
    let ok = r === true;
    if (!ok && !(typeof r === 'number' && Date.now() - r < 5 * 60_000)) {
      try { await relayTx(mirror!, primary, u.txid); ok = true; } catch (e) { console.error('faucet relay failed', u.txid, (e as Error).message); }
      relayed.set(u.txid, ok || Date.now());
    }
    if (ok) utxos.push(u); else pendingSats += u.satoshis;
  }
  utxos.sort((a, b) => (b.satoshis > a.satoshis ? 1 : b.satoshis < a.satoshis ? -1 : 0));
  return { utxos, sats: utxos.reduce((s, u) => s + u.satoshis, 0n), pendingSats };
}

/** Largest-first coins that cover `amount` plus fee room; null if the faucet cannot cover it. */
export function selectCoins(utxos: Utxo[], amount: bigint): Utxo[] | null {
  const out: Utxo[] = [];
  let sum = 0n;
  for (const u of utxos) {
    if (sum >= amount + DRIP_FEE_ROOM) break;
    out.push(u);
    sum += u.satoshis;
  }
  return sum >= amount + DRIP_FEE_ROOM ? out : null;
}

export function createFaucet(o: FaucetOptions) {
  if (o.network !== 'chipnet' && o.network !== 'mocknet') throw new Error('faucet drip is chipnet-only');
  const address = p2pkhAddress(pubFromPriv(o.faucetPriv), 'chipnet');
  // Per-wallet: a visitor's wallet may drip again while it holds less than this (a tab needs about 5,100 sats).
  const refillBelow = o.refillBelowSats ?? 6_000n;
  // Faucet's own balance: top up from the public faucet below this, never less than 4 drips (0 = off).
  const minTopUp = 4n * o.dripSats;
  const topUpBelow = o.topUpBelowSats === 0n ? 0n : (o.topUpBelowSats ?? 0n) > minTopUp ? o.topUpBelowSats! : minTopUp;
  const relayed = new Map<string, boolean | number>();
  const l = o.limits ?? {};
  const perIp = new RateLimiter(...(l.perIp ?? [6, 60 * 60_000]));
  const perAddress = new RateLimiter(...(l.perAddress ?? [3, 60 * 60_000]));
  const global = new RateLimiter(...(l.global ?? [60, 60 * 60_000]));
  let busy: Promise<unknown> = Promise.resolve();
  let lastTopUp = 0;
  let lastTopUpTxid: string | undefined;

  const balanceOf = async (a: string) => (await o.provider.getUtxos(a)).filter((u) => !u.token).reduce((s, u) => s + u.satoshis, 0n);
  const coins = () => faucetCoins(o.provider, address, o.mirror, relayed);

  async function maybeTopUp() {
    if (topUpBelow <= 0n || o.network !== 'chipnet' || Date.now() - lastTopUp < 30 * 60_000) return;
    const c = await coins();
    if (c.sats + c.pendingSats >= topUpBelow) return;
    lastTopUp = Date.now();
    try {
      lastTopUpTxid = await publicChipnetFaucet(address, o.topUpSats ?? 500_000n, o.fetchImpl);
      console.log('faucet topped up from public chipnet faucet', lastTopUpTxid);
      if (o.mirror) await relayTx(o.mirror, o.provider, lastTopUpTxid).catch((e) => console.error('top-up relay failed', (e as Error).message));
    } catch (e) { console.error('faucet top-up failed', (e as Error).message); }
  }

  async function drip(to: string) {
    const run = busy.then(async () => {
      const utxos = selectCoins((await coins()).utxos, o.dripSats);
      if (!utxos) throw Object.assign(new Error('The test-coin faucet is empty right now.'), { code: 'faucet_empty' });
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
      const c = await coins().catch(() => ({ sats: 0n, pendingSats: 0n }));
      json(res, 200, {
        enabled: true, network: 'chipnet', dripSats: o.dripSats.toString(), refillBelowSats: refillBelow.toString(),
        topUpBelowSats: topUpBelow.toString(), address, balanceSats: c.sats.toString(), pendingSats: c.pendingSats.toString(),
        drips: (c.sats / (o.dripSats + DRIP_FEE_ROOM)).toString(), lastTopUpTxid,
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
    const empty = () => {
      json(res, 503, { error: 'faucet_empty', retryable: false, message: 'Free test coins are refilling. Watch the house agent open and settle a tab instead.' });
      maybeTopUp().catch(() => {});
      return true;
    };
    // Check the faucet can pay BEFORE counting quota: an empty faucet must never burn a visitor's limit.
    const have = await coins().catch(() => null);
    if (have && !selectCoins(have.utxos, o.dripSats)) return empty();
    const ip = clientIp(req, !!o.trustProxy);
    const taken = takeAll([[perAddress, to], [perIp, ip], [global, 'all']]);
    if (taken.wait) {
      json(res, 429, { error: 'rate_limited', retryable: false, message: `Test-coin limit reached. Try again in ${Math.ceil(taken.wait / 60_000)} min.`, retryInMs: taken.wait });
      return true;
    }
    try {
      json(res, 200, { txid: await drip(to), sats: o.dripSats.toString() });
    } catch (e) {
      taken.refund(); // nothing was sent: give the visitor their quota back
      if ((e as { code?: string }).code === 'faucet_empty') return empty();
      json(res, 503, { error: 'faucet_failed', message: (e as Error).message });
    } finally {
      maybeTopUp().catch(() => {});
    }
    return true;
  };

  return { address, handler, drip, balance: async () => (await coins()).sats, maybeTopUp, topUpBelowSats: topUpBelow };
}
