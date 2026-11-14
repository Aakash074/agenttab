import type { DemoCall, FeedEvent, Stats } from '../lib/api';
import { ago, sats, short, usd } from '../lib/format';
import { SERVERS, explorerTx, type Net } from '../config';
import { useNow } from './Feed';
import { Journey, type JourneyState } from './Journey';

export type DemoRun = { busy: boolean; at?: number; result?: { ok: true; r: DemoCall } | { ok: false; msg: string } };

function apiHost(net: Net) {
  try { return new URL(SERVERS[net] || window.location.origin).host; } catch { return 'localhost'; }
}

function Receipt({ events, net, bchUsd, pinTab }: { events: FeedEvent[]; net: Net; bchUsd?: number; pinTab?: string }) {
  const now = useNow(1000);
  const pinned = pinTab ? events.find((e) => e.type === 'pay' && e.tab === pinTab) : undefined;
  const pay = pinned ?? events.find((e) => e.type === 'pay');
  const mine = !!pinTab && pay?.tab === pinTab;
  const open = pay && events.find((e) => e.type === 'open' && e.tab === pay.tab);
  const close = pay && events.find((e) => (e.type === 'settle' || e.type === 'cancel') && e.tab === pay.tab);
  const calls = pay ? events.filter((e) => e.type === 'pay' && e.tab === pay.tab).length : 0;
  const budget = open?.amount ? BigInt(open.amount) : undefined;
  const spent = BigInt(close?.type === 'settle' ? close.amount ?? 0 : pay?.amount ?? 0);
  const pct = budget ? Math.min(100, Number((spent * 1000n) / (budget - 546n)) / 10) : 0;
  const fresh = pay && now - Date.parse(pay.at) < 15_000;
  const justSettled = close && now - Date.parse(close.at) < 20_000;
  const link = 'tap text-bch-2 hover:underline';
  const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
    <div className="flex items-baseline justify-between gap-4"><span className="text-dim">{k}</span><span className="text-right text-fg">{v}</span></div>
  );
  return (
    <div id="receipt" className={`slip min-w-0 scroll-mt-24 self-start font-mono text-[12.5px] transition-colors ${fresh ? 'border-bch' : ''}`}>
      <div className="px-5 pb-1 pt-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] font-semibold tracking-[0.2em] text-fg">AGENTTAB</span>
          <span className="text-[13px] font-semibold text-fg">{pay ? `TAB #${pay.tab.slice(0, 4).toUpperCase()}` : 'TAB #----'}</span>
        </div>
        <div className="mt-1 flex items-center justify-between gap-3 text-[11px] text-dim">
          <span className="truncate">{mine ? <span className="text-bch-2">your tab</span> : pay?.demo ? 'house demo agent' : 'agent'} · {apiHost(net)}</span>
          {pay && <span className={`whitespace-nowrap ${fresh ? 'text-bch-2' : ''}`}>{ago(pay.at, now)}</span>}
        </div>
      </div>
      <div className="slip-tear my-3" />
      {pay ? (
        <>
          <div className="grid gap-1.5 px-5">
            <Row k={`GET ${pay.route ?? '/api/oracle'}`} v={<><span className="text-warn">402</span> → <span className="text-bch-2">200 OK</span></>} />
            <Row k="price per call" v={`${sats(pay.price)} sats`} />
            <Row k="last voucher" v={`#${calls}, signed by the agent`} />
            <Row k="on-chain txs for these calls" v="0" />
          </div>
          <div className="slip-tear my-3" />
          <div className="px-5">
            <div className="flex items-end justify-between gap-4">
              <span className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-dim">{close ? (close.type === 'settle' ? 'Total settled' : 'Waived') : 'Total'}
                {justSettled && <span className="stamp rounded border-2 border-bch-2 px-1.5 py-px text-[11px] font-bold tracking-[0.2em] text-bch-2">{close!.type === 'settle' ? 'SETTLED' : 'WAIVED'}</span>}
              </span>
              <span className="text-right"><span className="text-2xl font-bold text-fg">{sats(spent)}</span> <span className="text-muted">sats</span>
                {bchUsd && <span className="block text-[11px] text-dim">{usd(spent, bchUsd)}</span>}</span>
            </div>
            {budget && (
              <div className="mt-2">
                <div className="h-1.5 overflow-hidden rounded-full bg-subtle"><div className="h-full rounded-full bg-bch transition-all duration-700" style={{ width: `${pct}%` }} /></div>
                <div className="mt-1 flex justify-between gap-2 text-[11px] text-dim">
                  <span>tab {sats(budget)}</span>
                  <span>{close ? `${sats(budget - spent)} back to owner` : `${sats(budget - spent)} left`}</span>
                </div>
              </div>
            )}
          </div>
          <div className="slip-tear my-3" />
          <div className="grid gap-0.5 px-5 pb-4">
            <Row k="open" v={open?.txid ? <a className={link} href={explorerTx(net, open.txid)} target="_blank" rel="noreferrer">{short(open.txid, 6)} ↗</a> : '…'} />
            <Row k={close?.type === 'cancel' ? 'waive' : 'settle'} v={close?.txid ? <a className={link} href={explorerTx(net, close.txid)} target="_blank" rel="noreferrer">{short(close.txid, 6)} ↗</a> : <span className="text-dim">when the tab closes</span>} />
          </div>

        </>
      ) : (
        <p className="px-5 pb-6 text-dim">waiting for the first paid call…</p>
      )}
    </div>
  );
}

export function Hero({ events, stats, net, bchUsd, demoEnabled, demoIssue, pinTab, run, onRun, onFund, journey, onStartJourney, onResetJourney, hasOpenTab, timeline, apiDown, apiError, lastSeen, stale }: {
  events: FeedEvent[]; stats: Stats | null; net: Net; bchUsd?: number; demoEnabled: boolean; demoIssue?: string;
  pinTab?: string; run: DemoRun; onRun: () => void; onFund: () => void;
  journey: JourneyState; onStartJourney: () => void; onResetJourney: () => void;
  hasOpenTab?: boolean; timeline?: React.ReactNode;
  apiDown?: boolean; apiError?: boolean; lastSeen?: number | null; stale?: boolean;
}) {
  const now = useNow(5000);
  const res = run.result;
  return (
    <section className="relative overflow-hidden">
      <div className="relative mx-auto grid max-w-6xl gap-x-10 gap-y-6 px-4 pb-14 pt-8 md:grid-cols-[1.05fr_1fr] md:grid-rows-[auto_1fr] md:pt-16">
        <div className="order-1 min-w-0 md:order-none md:col-start-1 md:row-start-1">
          <p className="mb-5 inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-dim">
            <span className="h-1.5 w-1.5 rounded-full bg-bch pulse-dot" /> live on {net}
          </p>
          {stats && stats.paidCalls > 0 ? (
            <h1 className="break-words text-[32px] font-extrabold leading-[1.08] tracking-tight sm:text-[38px] md:text-[46px]">
              <span className="underline decoration-bch decoration-[5px] underline-offset-[6px]">{stats.paidCalls.toLocaleString()} API calls</span> paid by AI agents in {(stats.onchainTxs ?? 0).toLocaleString()} transactions.
            </h1>
          ) : (
            <h1 className="break-words text-[34px] font-extrabold leading-[1.06] tracking-tight sm:text-[40px] md:text-[52px]">
              Your AI agent just paid for <span className="underline decoration-bch decoration-[5px] underline-offset-[6px]">its own</span> API call. In Bitcoin Cash.
            </h1>
          )}
        </div>
        <div className="order-3 min-w-0 md:order-none md:col-start-2 md:row-span-2 md:row-start-1">
          <Receipt events={events} net={net} bchUsd={bchUsd} pinTab={pinTab} />
          {timeline}
          {stale && lastSeen && <p className="mt-2 text-right text-[11px] text-warn">last seen {ago(new Date(lastSeen).toISOString(), now)} · reconnecting</p>}
        </div>
        <div className="order-2 min-w-0 md:order-none md:col-start-1 md:row-start-2">
          <p className="max-w-xl text-[17px] leading-relaxed text-muted">
            Like a bar tab for software: you put a few cents behind the bar in <b className="text-fg">one transaction</b>, the AI agent pays per API call
            instantly and for free, and when you close the tab you get your change back. Bitcoin Cash script makes sure nobody can take more than was spent.
          </p>
          <div className="mt-7">
            <Journey j={journey} net={net} bchUsd={bchUsd} onStart={onStartJourney} onReset={onResetJourney}
              disabledReason={apiDown ? (apiError ? 'API reconnecting… (this takes a few seconds)' : 'Connecting to the API…') : undefined} />
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              {demoEnabled && !journey.active && (
                <button onClick={onRun} disabled={run.busy || apiDown} className="tap font-medium text-bch-2 hover:underline disabled:opacity-60">
                  {run.busy ? 'Agent is paying…' : hasOpenTab ? 'Run the agent once on your open tab' : 'Or watch the house demo agent pay once'}
                </button>
              )}
              <button onClick={onFund} className="tap font-medium text-muted hover:text-fg">Advanced: fund your own agent</button>
            </div>
          </div>
          <div className="mt-3 min-h-[44px] text-sm" aria-live="polite">
            {journey.done && (
              <p className="slide-in font-mono text-xs text-muted">This run: <b className="text-fg">3 API calls · 2 transactions · 0 fees between them</b></p>
            )}
            {!journey.active && !journey.done && res?.ok === true && (
              <p className="slide-in text-muted">
                <span className="text-bch-2">Paid {sats(res.r.priceSats)} sats</span> · voucher total {sats(res.r.cumulativeSats)}{pinTab && res.r.tab === pinTab ? ' on your tab' : ''}
                {run.at && <span className="text-dim"> · {ago(new Date(run.at).toISOString(), now)}</span>}. Answer: <span className="text-fg">{res.r.answer}</span>
              </p>
            )}
            {!journey.active && res?.ok === false && <p className="text-warn">{/rate/i.test(res.msg) ? 'Rate limited: one call every few seconds.' : res.msg}</p>}

            {!res && demoIssue && <p className="text-warn">The house demo agent is paused right now. Real payments in the feed and your own tab still work.</p>}
          </div>
          {stats && (
            <div className="card mt-5 max-w-xl overflow-hidden rounded-xl border border-line bg-panel">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3 py-2.5">
                <span className="text-[11px] uppercase tracking-wider text-dim">Total miner fees, all tabs</span>
                <span className="font-mono text-lg font-semibold">{stats.feeSats !== undefined ? (bchUsd ? usd(BigInt(stats.feeSats), bchUsd) : `${sats(stats.feeSats)} sats`) : '—'}</span>
              </div>
              {stats.perCallTxs !== undefined && stats.paidCalls > 0 && (
                <div className="border-t border-line bg-panel-2 px-3 py-2 text-xs text-dim">
                  vs paying on-chain per call: <span className="font-mono text-muted">{stats.perCallTxs.toLocaleString()} txs</span>
                  {' · '}<span className="font-mono text-muted">{bchUsd ? usd(BigInt(stats.perCallFeeSats ?? 0), bchUsd) : `${sats(stats.perCallFeeSats ?? 0)} sats`}</span> in fees,
                  {' '}<b className="text-bch-2">{Math.max(1, Math.round((stats.perCallTxs ?? 0) / Math.max(1, stats.onchainTxs ?? 1)))}× fewer transactions</b> with AgentTab
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
