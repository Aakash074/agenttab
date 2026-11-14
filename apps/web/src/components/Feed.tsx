import { useEffect, useState } from 'react';
import type { FeedEvent } from '../lib/api';
import { ago, sats, short } from '../lib/format';
import { explorerAddr, explorerTx, type Net } from '../config';

const KIND: Record<FeedEvent['type'], { label: string; tone: string }> = {
  open: { label: 'TAB OPENED', tone: 'text-info bg-info/10 ring-info/25' },
  pay: { label: 'PAID CALL', tone: 'text-bch-2 bg-bch/10 ring-bch/25' },
  settle: { label: 'SETTLED', tone: 'text-gold bg-gold/10 ring-gold/25' },
  cancel: { label: 'WAIVED', tone: 'text-info bg-info/10 ring-info/25' },
  expired: { label: 'EXPIRED', tone: 'text-muted bg-subtle ring-line' },
  closed: { label: 'REFUNDED', tone: 'text-muted bg-subtle ring-line' },
};

export function useNow(ms = 5000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

export function describe(e: FeedEvent) {
  const who = e.demo ? 'House demo agent' : 'Agent';
  switch (e.type) {
    case 'open': return <>Owner locked <b className="text-fg">{sats(e.amount)} sats</b> in a tab for {e.demo ? 'the demo agent' : 'an agent'}</>;
    case 'pay': return <>{who} paid <b className="text-fg">{sats(e.price)} sats</b> for <code className="font-mono text-fg">{e.route}</code> · voucher total {sats(e.amount)}</>;
    case 'settle': return <>Provider settled <b className="text-fg">{sats(e.amount)} sats</b>, remainder forced back to owner{e.auto ? ' (auto, before timeout)' : ''}</>;
    case 'cancel': return <>Provider waived the tab: the whole budget went back to the owner{e.auto ? ' (auto, before timeout)' : ''}</>;
    case 'expired': return <>Tab reached its timeout with nothing to settle</>;
    case 'closed': return <>Owner reclaimed the tab after timeout</>;
  }
}

const VISIBLE = 8;

export function Feed({ events, net, live, mine }: { events: FeedEvent[]; net: Net; live: boolean; mine?: Set<string> }) {
  const now = useNow();
  const [all, setAll] = useState(false);
  const shown = all ? events : events.slice(0, VISIBLE);
  return (
    <section id="feed" className="scroll-mt-24 self-start card rounded-2xl border border-line bg-panel">
      <header className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <span className={`h-2 w-2 rounded-full ${live ? 'bg-bch pulse-dot' : 'bg-dim'}`} />
          <h2 className="text-sm font-semibold tracking-wide">Live payment feed</h2>
          <span className="rounded bg-subtle px-1.5 py-0.5 font-mono text-[11px] text-muted">{net}</span>
        </div>
        <span className="text-xs text-dim">{live ? 'streaming' : 'polling'}</span>
      </header>
      {events.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-muted">No payments yet. Fund a tab (or run the demo agent, if this server hosts one) to see it here.</p>
      ) : (
        <>
          <ol className={`divide-y divide-line ${all ? 'max-h-[560px] overflow-y-auto' : ''}`}>
            {shown.map((e) => (
              <li key={e.id} className={`slide-in grid grid-cols-[auto_1fr] items-start gap-x-3 gap-y-1 px-5 py-3 text-sm sm:grid-cols-[auto_1fr_auto] ${mine?.has(e.tab) ? 'bg-bch/[0.06]' : ''}`}>
                <span className={`mt-0.5 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ring-1 ${KIND[e.type].tone}`}>{KIND[e.type].label}</span>
                <div className="min-w-0 text-muted">
                  <div>{describe(e)}{mine?.has(e.tab) && <span className="ml-1.5 rounded bg-bch/15 px-1.5 py-0.5 font-mono text-[10px] text-bch-2">your tab</span>}</div>
                  <div className="mt-0.5 flex flex-wrap gap-x-2 font-mono text-[11px] text-dim">
                    {e.contract
                      ? <a className="tap hover:text-bch-2" href={explorerAddr(net, e.contract)} target="_blank" rel="noreferrer" title="Covenant (P2SH32) address holding this tab">covenant {short(e.contract.split(':')[1] ?? e.contract, 5)}</a>
                      : <span className="tap">tab {short(e.tab.split(':')[0])}</span>}
                    {e.txid && <a className="tap text-bch-2 hover:underline" href={explorerTx(net, e.txid)} target="_blank" rel="noreferrer">tx {short(e.txid, 6)} ↗</a>}
                    {e.type === 'pay' && <span className="tap">off-chain voucher · no tx, no fee</span>}
                  </div>
                </div>
                <time className="col-start-2 whitespace-nowrap text-xs text-dim sm:col-start-auto">{ago(e.at, now)}</time>
              </li>
            ))}
          </ol>
          {events.length > VISIBLE && (
            <button onClick={() => setAll((v) => !v)} className="w-full border-t border-line px-5 py-2.5 text-xs font-medium text-muted hover:text-fg">
              {all ? 'Show latest only' : `Show all ${events.length} events`}
            </button>
          )}
        </>
      )}
    </section>
  );
}
