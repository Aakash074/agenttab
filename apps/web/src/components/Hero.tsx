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
  const mine = !!pinned;
  const open = pay && events.find((e) => e.type === 'open' && e.tab === pay.tab);
  const settle = pay && events.find((e) => e.type === 'settle' && e.tab === pay.tab);
  const callNo = pay && pay.price ? Number(BigInt(pay.amount ?? 0) / BigInt(pay.price)) : 0;
  const budget = open?.amount ? BigInt(open.amount) : undefined;
  const spent = BigInt(settle?.amount ?? pay?.amount ?? 0);
  const pct = budget ? Math.min(100, Number((spent * 1000n) / (budget - 546n)) / 10) : 0;
  const fresh = pay && now - Date.parse(pay.at) < 15_000;
  const link = 'tap text-bch-2 hover:underline';
  return (
    <div id="receipt" className={`relative min-w-0 scroll-mt-24 self-start rounded-2xl border bg-panel/90 shadow-2xl backdrop-blur transition-colors ${fresh ? 'border-bch/60 shadow-bch/10' : 'border-line-2 shadow-bch/5'}`}>
      <div className="flex items-center gap-1.5 border-b border-line px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-white/10" /><span className="h-2.5 w-2.5 rounded-full bg-white/10" /><span className="h-2.5 w-2.5 rounded-full bg-white/10" />
        <span className="ml-3 truncate font-mono text-[11px] text-dim">
          {mine ? <span className="text-bch-2">your tab · {short(pay!.tab.split(':')[0], 4)}</span> : pay?.demo ? 'demo agent' : 'agent'} → {apiHost(net)}{pay?.route ?? '/api/oracle'}
        </span>
        {pay && <span className={`ml-auto whitespace-nowrap text-[11px] ${fresh ? 'text-bch-2' : 'text-dim'}`}>{ago(pay.at, now)}</span>}
      </div>
      {pay ? (
        <>
          <div className="flex items-end justify-between gap-4 px-5 pt-4">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-dim">Voucher</div>
              <div className="font-mono text-4xl font-bold leading-none">#{callNo}</div>
            </div>
            <div className="text-right">
              <div className="text-[11px] uppercase tracking-wider text-dim">{settle ? 'Settled' : 'Running total'}</div>
              <div className="font-mono text-xl font-semibold">{sats(spent)} <span className="text-sm text-muted">sats</span></div>
              {bchUsd && <div className="text-xs text-dim">{usd(spent, bchUsd)}</div>}
            </div>
          </div>
          {budget && (
            <div className="px-5 pt-3">
              <div className="h-1.5 overflow-hidden rounded-full bg-white/5"><div className="h-full rounded-full bg-gradient-to-r from-bch to-bch-2 transition-all duration-700" style={{ width: `${pct}%` }} /></div>
              <div className="mt-1 flex justify-between gap-2 font-mono text-[11px] text-dim">
                <span>tab {sats(budget)}</span>
                <span>{settle ? `${sats(budget - spent)} returned to owner` : `${sats(budget - spent)} left`}</span>
              </div>
            </div>
          )}
          <pre className="whitespace-pre-wrap break-words px-5 py-4 font-mono text-[12.5px] leading-6 text-muted sm:overflow-x-auto sm:whitespace-pre">
<span className="text-fg">GET</span> {pay.route ?? '/api/oracle'}{'\n'}
<span className="text-warn">402 Payment Required</span>  scheme=<span className="text-fg">bch-credit</span> price=<span className="text-fg">{sats(pay.price)}</span>{'\n'}
<span className="text-fg">X-PAYMENT</span> voucher #{callNo} · total {sats(pay.amount)} · signed by agent{'\n'}
<span className="text-bch-2">200 OK</span>  <span className="text-dim">no transaction, no fee</span>{'\n'}
<span className="text-dim">──────────────────────────</span>{'\n'}
open   {open?.txid ? <a className={link} href={explorerTx(net, open.txid)} target="_blank" rel="noreferrer">{short(open.txid, 8)} ↗</a> : <span className="text-dim">…</span>}{'\n'}
settle {settle?.txid ? <a className={link} href={explorerTx(net, settle.txid)} target="_blank" rel="noreferrer">{short(settle.txid, 8)} ↗</a> : <span className="text-dim">provider settles any time</span>}
          </pre>
        </>
      ) : (
        <p className="px-5 py-10 font-mono text-sm text-dim">waiting for the first paid call…</p>
      )}
    </div>
  );
}

export function Hero({ events, stats, net, bchUsd, demoEnabled, demoIssue, pinTab, run, onRun, onFund, journey, onStartJourney, onResetJourney, apiDown, lastSeen, stale }: {
  events: FeedEvent[]; stats: Stats | null; net: Net; bchUsd?: number; demoEnabled: boolean; demoIssue?: string;
  pinTab?: string; run: DemoRun; onRun: () => void; onFund: () => void;
  journey: JourneyState; onStartJourney: () => void; onResetJourney: () => void;
  apiDown?: boolean; lastSeen?: number | null; stale?: boolean;
}) {
  const now = useNow(5000);
  const res = run.result;
  return (
    <section className="relative overflow-hidden">
      <div className="grid-bg pointer-events-none absolute inset-0" />
      <div className="relative mx-auto grid max-w-6xl gap-x-10 gap-y-6 px-4 pb-14 pt-8 md:grid-cols-[1.05fr_1fr] md:grid-rows-[auto_1fr] md:pt-16">
        <div className="min-w-0 md:col-start-1 md:row-start-1">
          <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-line-2 bg-panel px-3 py-1 text-xs text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-bch pulse-dot" /> A refundable tab: one tx to open, any number of calls, one tx to settle · live on {net}
          </p>
          <h1 className="break-words text-[34px] font-extrabold leading-[1.05] tracking-tight sm:text-[40px] md:text-[54px]">
            Your AI agent just paid for its own API call.<span className="text-bch"> In Bitcoin Cash.</span>
          </h1>
        </div>
        <div className="min-w-0 md:col-start-2 md:row-span-2 md:row-start-1">
          <Receipt events={events} net={net} bchUsd={bchUsd} pinTab={pinTab} />
          {stale && lastSeen && <p className="mt-2 text-right text-[11px] text-warn">last seen {ago(new Date(lastSeen).toISOString(), now)} · reconnecting</p>}
        </div>
        <div className="min-w-0 md:col-start-1 md:row-start-2">
          <p className="max-w-xl text-[17px] leading-relaxed text-muted">
            Like a bar tab for software: you put a few cents behind the bar in <b className="text-fg">one transaction</b>, the AI agent pays per API call
            instantly and for free, and when you close the tab you get your change back. Bitcoin Cash script makes sure nobody can take more than was spent.
          </p>
          <div className="mt-7">
            <Journey j={journey} net={net} bchUsd={bchUsd} onStart={onStartJourney} onReset={onResetJourney}
              disabledReason={apiDown ? 'API reconnecting… (this takes a few seconds)' : undefined} />
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              {demoEnabled && !journey.active && (
                <button onClick={onRun} disabled={run.busy || apiDown} className="tap font-medium text-bch-2 hover:underline disabled:opacity-60">
                  {run.busy ? 'Agent is paying…' : pinTab ? '▶ Just run the agent on your tab' : '▶ Or just watch the demo agent pay once'}
                </button>
              )}
              <button onClick={onFund} className="tap font-medium text-muted hover:text-fg">Advanced: fund your own agent</button>
            </div>
          </div>
          <div className="mt-3 min-h-[44px] text-sm" aria-live="polite">
            {res?.ok === true && (
              <p className="slide-in text-muted">
                <span className="text-bch-2">Paid {sats(res.r.priceSats)} sats</span> · voucher total {sats(res.r.cumulativeSats)}{pinTab && res.r.tab === pinTab ? ' on your tab' : ''}
                {run.at && <span className="text-dim"> · {ago(new Date(run.at).toISOString(), now)}</span>}. Oracle: <span className="text-fg">{res.r.answer}</span>
              </p>
            )}
            {res?.ok === false && <p className="text-warn">{/rate/i.test(res.msg) ? 'Easy, one call every few seconds.' : res.msg}</p>}
            {!res && demoEnabled && !demoIssue && !journey.active && <p className="text-dim">The AI agent runs on our server and pays with signed vouchers. Watch the receipt on the right.</p>}
            {!res && demoIssue && <p className="text-warn">The demo agent hit a snag ({demoIssue.slice(0, 120)}). The feed below still shows real payments.</p>}
          </div>
          {stats && (
            <div className="mt-5 max-w-xl overflow-hidden rounded-xl border border-line bg-panel">
              <div className="grid grid-cols-3 divide-x divide-line">
                {[
                  ['API calls paid', stats.paidCalls.toLocaleString()],
                  ['on-chain txs', String(stats.onchainTxs ?? '—')],
                  ['total fees', stats.feeSats !== undefined ? (bchUsd ? usd(BigInt(stats.feeSats), bchUsd) : `${sats(stats.feeSats)} sats`) : '—'],
                ].map(([k, v]) => (
                  <div key={k} className="min-w-0 px-3 py-2.5">
                    <div className="truncate font-mono text-lg font-semibold">{v}</div>
                    <div className="whitespace-nowrap text-[10px] uppercase tracking-wider text-dim sm:text-[11px]">{k}</div>
                  </div>
                ))}
              </div>
              {stats.perCallTxs !== undefined && stats.paidCalls > 0 && (
                <div className="border-t border-line bg-ink/40 px-3 py-2 text-xs text-dim">
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
