import type { DemoCall, FeedEvent, Stats } from '../lib/api';
import { ago, plural, ratio, sats, short, usd } from '../lib/format';
import { SERVERS, explorerTx, type Net } from '../config';
import { useNow } from './Feed';
import { Journey, type JourneyState } from './Journey';

export type DemoRun = { busy: boolean; at?: number; result?: { ok: true; r: DemoCall } | { ok: false; msg: string } };

function apiHost(net: Net) {
  try { return new URL(SERVERS[net] || window.location.origin).host; } catch { return 'localhost'; }
}

/** A paid call the page itself just saw (the API answer), so the receipt never lags the step counter. */
export type LocalPaid = { tab: string; calls: number; cumulative: bigint; price: bigint };

function Receipt({ events, net, bchUsd, tab, mine, local }: { events: FeedEvent[]; net: Net; bchUsd?: number; tab?: string; mine?: boolean; local?: LocalPaid }) {
  const now = useNow(1000);
  const pays = tab ? events.filter((e) => e.type === 'pay' && e.tab === tab) : [];
  const pay = pays[0];
  const loc = local && local.tab === tab ? local : undefined;
  const open = tab ? events.find((e) => e.type === 'open' && e.tab === tab) : undefined;
  const close = tab ? events.find((e) => (e.type === 'settle' || e.type === 'cancel') && e.tab === tab) : undefined;
  const calls = Math.max(pays.length, loc?.calls ?? 0);
  const paid = !!pay || !!loc || close?.type === 'settle';
  const budget = open?.amount ? BigInt(open.amount) : undefined;
  const voucher = BigInt(pay?.amount ?? 0) > (loc?.cumulative ?? 0n) ? BigInt(pay!.amount!) : (loc?.cumulative ?? 0n);
  const spent = close?.type === 'settle' ? BigInt(close.amount ?? 0) : voucher;
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
          <span className="text-[13px] font-semibold text-fg">{tab ? `TAB #${tab.slice(0, 4).toUpperCase()}` : 'TAB #----'}</span>
        </div>
        <div className="mt-1 flex items-center justify-between gap-3 text-[11px] text-dim">
          <span className="truncate">{mine ? <span className="text-bch-2">your tab</span> : (pay ?? open)?.demo ? 'house demo agent' : 'agent'} · {apiHost(net)}</span>
          {pay && <span className={`whitespace-nowrap ${fresh ? 'text-bch-2' : ''}`}>{ago(pay.at, now)}</span>}
        </div>
      </div>
      <div className="slip-tear my-3" />
      {paid ? (
        <>
          <div className="grid gap-1.5 px-5">
            <Row k={`GET ${pay?.route ?? '/api/oracle'}`} v={<><span className="text-warn">402</span> → <span className="text-bch-2">200 OK</span></>} />
            {(pay?.price ?? loc?.price) && <Row k="price per call" v={`${sats(pay?.price ?? loc?.price)} sats`} />}
            <Row k="last voucher" v={calls ? `#${calls}, signed by the agent` : close?.calls ? `${close.calls} call${close.calls === 1 ? '' : 's'}, from the settle tx` : 'cumulative, signed by the agent'} />
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
                  <span>{close ? `${sats(close.type === 'cancel' ? budget : budget - spent)} back to ${mine ? 'you' : 'owner'}` : `${sats(budget - spent)} left`}</span>
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
        <p className="px-5 pb-6 text-dim">{tab ? 'tab open · waiting for the first paid call…' : 'waiting for the first paid call…'}</p>
      )}
    </div>
  );
}

/** Headline stats are only worth leading with once there is a real body of traffic. */
const HEADLINE_MIN_CALLS = 50;

function FeeBox({ stats, bchUsd, priceLoading }: { stats: Stats; bchUsd?: number; priceLoading?: boolean }) {
  const fee = stats.feeSats ?? 0, txs = stats.onchainTxs ?? 0;
  const perCallTxs = stats.perCallTxs ?? stats.paidCalls, perCallFee = stats.perCallFeeSats ?? 0;
  // While the API (and its BCH price) is still loading, a placeholder avoids a sats → $ flash.
  const money = (v: number): React.ReactNode => (bchUsd ? usd(BigInt(Math.round(v)), bchUsd)
    : priceLoading ? <span className="inline-block h-[0.9em] w-12 animate-pulse rounded bg-subtle align-middle" aria-label="loading" /> : `${sats(Math.round(v))} sats`);
  const box = 'card mt-5 max-w-xl overflow-hidden rounded-xl border border-line bg-panel';
  if (fee < perCallFee) {
    return (
      <div className={box}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3 py-2.5">
          <span className="text-[11px] uppercase tracking-wider text-dim">Total miner fees, all tabs</span>
          <span className="font-mono text-lg font-semibold">{money(fee)}</span>
        </div>
        <div className="border-t border-line bg-panel-2 px-3 py-2 text-xs text-dim">
          Paying on-chain per call would take <span className="font-mono text-muted">{plural(perCallTxs, 'transaction')}</span> and{' '}
          <span className="font-mono text-muted">{money(perCallFee)}</span> in fees. AgentTab used{' '}
          <span className="font-mono text-muted">{plural(txs, 'transaction')}</span>: <b className="text-bch-2">{ratio(perCallTxs, txs)} fewer</b>.
        </div>
      </div>
    );
  }
  // Not cheaper yet (few calls per tab so far): say honestly where a tab starts to pay off.
  const perTab = txs > 0 ? (2 * fee) / txs : 770;
  const perCall = perCallTxs > 0 ? perCallFee / perCallTxs : 226;
  const breakEven = Math.floor(perTab / perCall) + 1;
  return (
    <div className={box}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3 py-2.5">
        <span className="text-[11px] uppercase tracking-wider text-dim">A tab is cheaper than paying per call</span>
        <span className="font-mono text-lg font-semibold">from {breakEven}+ calls</span>
      </div>
      <div className="border-t border-line bg-panel-2 px-3 py-2 text-xs text-dim">
        A tab costs 2 transactions (open and close), about <span className="font-mono text-muted">{money(perTab)}</span> in miner fees, however many calls it pays for.
        Paying on-chain costs about <span className="font-mono text-muted">{money(perCall)}</span> per call.
      </div>
    </div>
  );
}

export function Hero({ events, stats, net, bchUsd, demoEnabled, demoIssue, tab, tabIsMine, local, run, onRun, onFund, journey, onStartJourney, onResetJourney, hasOpenTab, timeline, direct, apiDown, apiError, waking, wakeLong, queued, lastSeen, stale }: {
  events: FeedEvent[]; stats: Stats | null; net: Net; bchUsd?: number; demoEnabled: boolean; demoIssue?: string;
  /** The one tab the receipt (and the timeline under it) shows. */
  tab?: string; tabIsMine?: boolean; local?: LocalPaid;
  run: DemoRun; onRun: () => void; onFund: () => void;
  journey: JourneyState; onStartJourney: () => void; onResetJourney: () => void;
  hasOpenTab?: boolean; timeline?: React.ReactNode;
  /** The 1¢ direct-pay card: the first thing a visitor can do. */
  direct?: React.ReactNode;
  apiDown?: boolean; apiError?: boolean; waking?: boolean; wakeLong?: boolean; queued?: boolean; lastSeen?: number | null; stale?: boolean;
}) {
  const now = useNow(5000);
  const res = run.result;
  return (
    <section className="relative overflow-hidden">
      <div className="relative mx-auto grid max-w-6xl gap-x-10 gap-y-6 px-4 pb-14 pt-8 md:grid-cols-[1.05fr_1fr] md:grid-rows-[auto_1fr] md:pt-16">
        <div className="order-1 min-w-0 md:order-none md:col-start-1 md:row-start-1">
          <p className="mb-5 inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-dim">
            <span className={`h-1.5 w-1.5 rounded-full ${waking ? 'bg-dim' : 'bg-bch'} pulse-dot`} /> {waking ? `waking the ${net} server` : `live on ${net}`}
          </p>
          {stats && stats.paidCalls >= HEADLINE_MIN_CALLS ? (
            <h1 className="break-words text-[32px] font-extrabold leading-[1.08] tracking-tight sm:text-[38px] md:text-[46px]">
              <span className="underline decoration-bch decoration-[5px] underline-offset-[6px]">{plural(stats.paidCalls, 'API call')}</span> paid by AI agents in {plural(stats.onchainTxs ?? 0, 'transaction')}.
            </h1>
          ) : (
            <h1 className="break-words text-[34px] font-extrabold leading-[1.06] tracking-tight sm:text-[40px] md:text-[52px]">
              Your AI agent just paid for <span className="underline decoration-bch decoration-[5px] underline-offset-[6px]">its own</span> API call. In Bitcoin Cash.
            </h1>
          )}
        </div>
        <div className="order-3 min-w-0 md:order-none md:col-start-2 md:row-span-2 md:row-start-1">
          <Receipt events={events} net={net} bchUsd={bchUsd} tab={tab} mine={tabIsMine} local={local} />
          {timeline}
          {stale && !waking && lastSeen && <p className="mt-2 text-right text-[11px] text-warn">last seen {ago(new Date(lastSeen).toISOString(), now)} · reconnecting</p>}
        </div>
        <div className="order-2 min-w-0 md:order-none md:col-start-1 md:row-start-2">
          {direct}
          {stats && stats.paidCalls > 0 && stats.feeSats !== undefined && stats.perCallFeeSats !== undefined && <FeeBox stats={stats} bchUsd={bchUsd} priceLoading={apiDown} />}
          <div className="mb-7" />
          <p className="max-w-xl text-[17px] leading-relaxed text-muted">
            Like a bar tab for software: you put a few cents behind the bar in <b className="text-fg">one transaction</b>, the AI agent pays per API call
            instantly and for free, and when you close the tab you get your change back. Bitcoin Cash script makes sure nobody can take more than was spent.
          </p>
          <div className="mt-7">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-dim">The real thing: a 5¢ tab your agent spends</p>
            <Journey j={journey} net={net} bchUsd={bchUsd} onStart={onStartJourney} onReset={onResetJourney} waking={waking} wakeLong={wakeLong} queued={queued}
              disabledReason={queued ? 'Starting when the server is awake…' : apiDown && !waking ? (apiError ? 'API reconnecting… (a few seconds)' : 'Connecting to the API…') : undefined} />
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
                <span className="text-bch-2">Paid {sats(res.r.priceSats)} sats</span> · voucher total {sats(res.r.cumulativeSats)}{tabIsMine && res.r.tab === tab ? ' on your tab' : ''}
                {run.at && <span className="text-dim"> · {ago(new Date(run.at).toISOString(), now)}</span>}. Answer: <span className="text-fg">{res.r.answer}</span>
              </p>
            )}
            {!journey.active && res?.ok === false && <p className="text-warn">{/rate/i.test(res.msg) ? 'Rate limited: one call every few seconds.' : res.msg}</p>}

            {!res && !journey.active && !journey.done && demoIssue && <p className="text-muted">Demo agent idle. Press the button to run your own.</p>}
          </div>
        </div>
      </div>
    </section>
  );
}
