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
