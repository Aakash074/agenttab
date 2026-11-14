import { useEffect, useState } from 'react';
import type { FeedEvent } from '../lib/api';
import { ago, sats, short } from '../lib/format';
import { explorerTx, type Net } from '../config';

const KIND: Record<FeedEvent['type'], { label: string; tone: string }> = {
  open: { label: 'TAB OPENED', tone: 'text-sky-300 bg-sky-400/10 ring-sky-400/20' },
  pay: { label: 'PAID CALL', tone: 'text-bch-2 bg-bch/10 ring-bch/25' },
  settle: { label: 'SETTLED', tone: 'text-amber-200 bg-amber-300/10 ring-amber-300/25' },
  expired: { label: 'EXPIRED', tone: 'text-muted bg-white/5 ring-white/10' },
  closed: { label: 'REFUNDED', tone: 'text-muted bg-white/5 ring-white/10' },
};

export function useNow(ms = 5000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

export function describe(e: FeedEvent) {
  switch (e.type) {
    case 'open': return <>Owner locked <b className="text-fg">{sats(e.amount)} sats</b> for an agent</>;
    case 'pay': return <>Agent paid <b className="text-fg">{sats(e.price)} sats</b> for <code className="font-mono text-fg">{e.route}</code> · voucher total {sats(e.amount)}</>;
    case 'settle': return <>Provider settled <b className="text-fg">{sats(e.amount)} sats</b>, remainder forced back to owner{e.auto ? ' (auto, before timeout)' : ''}</>;
    case 'expired': return <>Tab reached its timeout with nothing to settle</>;
    case 'closed': return <>Owner reclaimed the tab after timeout</>;
  }
}

export function Feed({ events, net, live }: { events: FeedEvent[]; net: Net; live: boolean }) {
  const now = useNow();
  return (
    <section id="feed" className="rounded-2xl border border-line bg-panel">
      <header className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <span className={`h-2 w-2 rounded-full ${live ? 'bg-bch pulse-dot' : 'bg-dim'}`} />
          <h2 className="text-sm font-semibold tracking-wide">Live payment feed</h2>
          <span className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[11px] text-muted">{net}</span>
        </div>
        <span className="text-xs text-dim">{live ? 'streaming' : 'polling'}</span>
      </header>
      {events.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-muted">No payments yet. Start the demo agent or fund a tab to see it here.</p>
      ) : (
        <ol className="max-h-[440px] divide-y divide-line overflow-y-auto">
          {events.map((e) => (
            <li key={e.id} className="slide-in grid grid-cols-[auto_1fr_auto] items-start gap-3 px-5 py-3 text-sm">
              <span className={`mt-0.5 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ring-1 ${KIND[e.type].tone}`}>{KIND[e.type].label}</span>
              <div className="min-w-0 text-muted">
                <div>{describe(e)}</div>
                <div className="mt-0.5 font-mono text-[11px] text-dim">
                  tab {short(e.tab.split(':')[0])}
                  {e.txid && (
                    <> · tx <a className="text-bch-2 hover:underline" href={explorerTx(net, e.txid)} target="_blank" rel="noreferrer">{short(e.txid, 8)}</a></>
                  )}
                  {e.type === 'pay' && <> · off-chain voucher, no tx needed</>}
                </div>
              </div>
              <time className="whitespace-nowrap text-xs text-dim">{ago(e.at, now)}</time>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
