export const sats = (v: string | bigint | number | undefined) =>
  v === undefined ? '—' : BigInt(v).toLocaleString('en-US');

export const short = (s: string, n = 6) => (s.length <= n * 2 + 1 ? s : `${s.slice(0, n)}…${s.slice(-n)}`);

export function ago(iso: string, now = Date.now()) {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** ~10 minutes per BCH block. */
export function blocksToText(blocks: number) {
  if (blocks <= 0) return 'now';
  const m = blocks * 10;
  if (m < 60) return `~${m} min`;
  if (m < 60 * 48) return `~${Math.round(m / 60)} h`;
  return `~${Math.round(m / 1440)} days`;
}

export const usd = (satoshis: bigint | number, price?: number) =>
  price ? `$${((Number(satoshis) / 1e8) * price).toFixed(Number(satoshis) * price < 1e8 * 0.1 ? 4 : 2)}` : '';
