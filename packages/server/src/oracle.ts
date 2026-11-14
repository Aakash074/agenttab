// "BCH market oracle": the paid demo endpoint. Real data from free, key-less sources:
//  - BCH/USD spot from CoinGecko's public simple-price API (fallback: Kraken public ticker), cached 60s
//  - chain tip from the server's own Electrum connection
import type { NetworkProvider } from 'cashscript';

interface Price { usd: number; change24h?: number; source: string; fetchedAt: string }
let cache: { at: number; price: Price } | undefined;

async function fetchJson(url: string) {
  const r = await fetch(url, { signal: AbortSignal.timeout(5000), headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

/** Non-blocking: returns the cached price at once and refreshes it in the background. */
export function bchPriceCached(): number | undefined {
  if (!cache || Date.now() - cache.at > 60_000) void bchPrice().catch(() => {});
  return cache?.price.usd;
}

export async function bchPrice(): Promise<Price | undefined> {
  if (cache && Date.now() - cache.at < 60_000) return cache.price;
  let price: Price | undefined;
  try {
    const j = await fetchJson('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin-cash&vs_currencies=usd&include_24hr_change=true');
    price = { usd: j['bitcoin-cash'].usd, change24h: j['bitcoin-cash'].usd_24h_change, source: 'coingecko', fetchedAt: new Date().toISOString() };
  } catch {
    try {
      const j = await fetchJson('https://api.kraken.com/0/public/Ticker?pair=BCHUSD');
      const t = Object.values(j.result)[0] as { c: string[]; o: string };
      const usd = Number(t.c[0]);
      price = { usd, change24h: (usd / Number(t.o) - 1) * 100, source: 'kraken', fetchedAt: new Date().toISOString() };
    } catch { /* both sources down */ }
  }
  if (price) cache = { at: Date.now(), price };
  return price ?? cache?.price;
}

export function oracleHandler(provider: NetworkProvider, network: string) {
  return async (url: URL) => {
    const q = (url.searchParams.get('q') ?? 'price').slice(0, 200);
    const [price, tip] = await Promise.all([bchPrice(), provider.getBlockHeight().catch(() => undefined)]);
    const usd = price?.usd;
    const chg = price?.change24h ?? 0;
    const answer = usd
      ? `BCH is $${usd.toFixed(2)} (${chg >= 0 ? '+' : ''}${chg.toFixed(2)}% 24h, ${price!.source}). ` +
        `1000 sats ≈ $${(usd * 1e-5).toFixed(4)}. ${network} tip: block ${tip ?? '?'}.`
      : `Price sources unreachable right now. ${network} tip: block ${tip ?? '?'}.`;
    return { q, answer, data: { bchUsd: usd, change24h: price?.change24h, priceSource: price?.source, priceAt: price?.fetchedAt, network, tip } };
  };
}


/** Cheaper route: just the chain tip and the latest block's timestamp. */
export function tipHandler(provider: NetworkProvider, network: string) {
  return async () => {
    const tip = await provider.getBlockHeight().catch(() => undefined);
    let time: number | undefined;
    try {
      const hex = await (provider as { performRequest?: (m: string, ...p: number[]) => Promise<unknown> }).performRequest?.('blockchain.block.header', tip!);
      if (typeof hex === 'string') time = Buffer.from(hex.slice(136, 144), 'hex').readUInt32LE(0);
    } catch { /* header unavailable */ }
    return { answer: `${network} tip is block ${tip ?? '?'}${time ? `, mined ${new Date(time * 1000).toISOString()}` : ''}.`, data: { network, tip, time } };
  };
}

let fxCache: { at: number; v: Record<string, number> } | undefined;
/** Mid-price route: BCH in USD/EUR/INR/JPY from CoinGecko (no key), cached 60 s. */
export function fxHandler() {
  return async () => {
    if (!fxCache || Date.now() - fxCache.at > 60_000) {
      try {
        const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin-cash&vs_currencies=usd,eur,inr,jpy', { signal: AbortSignal.timeout(5000) });
        if (r.ok) fxCache = { at: Date.now(), v: (await r.json())['bitcoin-cash'] };
      } catch { /* keep stale cache */ }
    }
    const v = fxCache?.v;
    return { answer: v ? `1 BCH = $${v.usd} · €${v.eur} · ₹${v.inr} · ¥${v.jpy} (coingecko)` : 'FX source unreachable right now.', data: v ?? null };
  };
}
