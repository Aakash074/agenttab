import { useEffect, useState } from 'react';
import type { FeedEvent, TabRecord } from '../lib/api';
import { api } from '../lib/api';
import { plural, sats } from '../lib/format';
import { CONTRACT_SOURCE_URL } from '../config';

const I = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
const STEPS = [
  { n: 'Open', tx: '1 tx', zero: false, body: 'You lock a few cents in a covenant for one agent.',
    icon: <svg width="18" height="18" viewBox="0 0 24 24" {...I}><rect x="4.5" y="10.5" width="15" height="10" rx="2.5" /><path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7M12 14.5v2.2" /></svg> },
  { n: 'Pay per call', tx: '0 tx', zero: true, body: 'For each API call the agent signs a voucher. Instant, no fee.',
    icon: <svg width="18" height="18" viewBox="0 0 24 24" {...I}><path d="M6 3.5h12v17l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3-2 1.3z" /><path d="M9 8.5h6M9 12h6M9 15.5h3" /></svg> },
  { n: 'Close', tx: '1 tx', zero: false, body: 'The provider claims the last voucher. The rest must come back to you.',
    icon: <svg width="18" height="18" viewBox="0 0 24 24" {...I}><path d="M4 12a8 8 0 1 0 2.3-5.6M4 4.5v3.9h3.9" /><path d="m9 12.2 2.1 2.1 4-4.3" /></svg> },
];

/** The most recent settled tab (attack runs excluded): its own calls and transactions, nothing aggregated. */
function useLastTab(events: FeedEvent[]) {
  const id = events.find((e) => e.type === 'settle' && e.tag !== 'attack')?.tab;
  const [tab, setTab] = useState<TabRecord | null>(null);
  useEffect(() => {
    if (!id) { setTab(null); return; }
    let stop = false;
    api.tab(id).then((t) => !stop && setTab(t)).catch(() => {});
    return () => { stop = true; };
  }, [id]);
  return tab && tab.id === id && tab.status === 'settled' && tab.requests > 0 ? tab : null;
}

/** Baseline: paying on-chain per call = one ~226-byte P2PKH payment per call (1 sat/byte), as the server's stats assume. */
const PER_CALL_FEE = 226;

function LastTabBox({ tab }: { tab: TabRecord }) {
  const n = tab.requests;
  const fee = tab.openTxBytes && tab.settleTxBytes ? tab.openTxBytes + tab.settleTxBytes : undefined;
  return (
    <p className="text-sm text-muted">
      Last tab: <b className="text-fg">{plural(n, 'call')} · 2 on-chain transactions</b> (paying per call: {plural(n, 'transaction')}).
      {fee !== undefined && <> Its two transactions cost {sats(fee)} sats in miner fees, a flat cost however many calls a tab covers; paying per call costs about {PER_CALL_FEE} sats a call,
        so a tab is <b className="text-bch-2">cheaper from {Math.floor(fee / PER_CALL_FEE) + 1} calls</b>.</>}
    </p>
  );
}

export function HowItWorks({ events, direct, advanced, advancedOpen, onAdvancedToggle }: {
  /** Newest first, as the feed holds them. */
  events: FeedEvent[];
  /** The 1¢ no-tab card (shown here when it isn't the hero action). */
  direct?: React.ReactNode;
  advanced: React.ReactNode; advancedOpen: boolean; onAdvancedToggle: (open: boolean) => void;
}) {
  const lastTab = useLastTab(events);
  return (
    <div id="how" className="grid scroll-mt-24 gap-5">
      <ol className="grid gap-3 sm:grid-cols-3">
        {STEPS.map((s, i) => (
          <li key={s.n} className="card card-lift relative rounded-2xl border border-line bg-panel p-4 sm:p-5">
            <div className="flex items-center justify-between gap-2">
              <span className="step-icon" aria-hidden>{s.icon}</span>
              <span className={`chip-tx ${s.zero ? 'is-zero' : ''}`} title={s.zero ? 'No on-chain transaction per call' : 'One on-chain transaction'}>{s.tx}</span>
            </div>
            <p className="mt-3 font-semibold"><span className="font-mono text-[12px] text-dim">0{i + 1}</span> {s.n}</p>
            <p className="mt-1 text-sm text-muted">{s.body}</p>
          </li>
        ))}
      </ol>
      <div className="card card-lift grid gap-3 rounded-2xl border border-line bg-panel p-5">
        <h3 className="flex items-center gap-3 font-semibold"><span className="step-icon" aria-hidden><svg width="18" height="18" viewBox="0 0 24 24" {...I}><path d="M12 3.5 5 6v5.5c0 4.2 2.9 7.6 7 9 4.1-1.4 7-4.8 7-9V6z" /><path d="m9.2 12 2 2 3.8-4" /></svg></span>Who can take what</h3>
        <p className="text-sm text-muted">
          A Bitcoin Cash covenant holds the money. The provider can claim only the highest voucher the agent signed, and the transaction must send
          the rest back to the owner. The agent can never withdraw. If the provider vanishes, the owner takes everything back after the timeout.
        </p>
        {lastTab && <LastTabBox tab={lastTab} />}
        <a className="tap text-sm font-medium text-bch-2 hover:underline" href={CONTRACT_SOURCE_URL || api.contractUrl()} target="_blank" rel="noreferrer">Read the covenant (AgentTab.cash) ↗</a>
      </div>
      {direct}
      <details id="advanced" open={advancedOpen} onToggle={(e) => onAdvancedToggle((e.target as HTMLDetailsElement).open)}
        className="card group rounded-2xl border border-line bg-panel">
        <summary className="flex min-h-[52px] cursor-pointer list-none items-center justify-between gap-3 px-5 font-semibold">
          <span>Advanced: fund a tab for your own agent</span>
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line-2 bg-panel text-muted"><svg aria-hidden viewBox="0 0 12 12" fill="none" className="h-3.5 w-3.5 transition-transform group-open:rotate-180"><path d="M2.75 4.5 6 7.75 9.25 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
        </summary>
        <div className="border-t border-line">{advanced}</div>
      </details>
    </div>
  );
}
