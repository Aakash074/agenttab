import { useState } from 'react';
import { api, type DemoCall, type FeedEvent, type Stats } from '../lib/api';
import { ago, sats, short, usd } from '../lib/format';
import { SERVERS, explorerTx, type Net } from '../config';
import { useNow } from './Feed';

function apiHost(net: Net) {
  try { return new URL(SERVERS[net] || window.location.origin).host; } catch { return 'localhost'; }
}

function Receipt({ events, net, bchUsd }: { events: FeedEvent[]; net: Net; bchUsd?: number }) {
  const now = useNow(1000);
  const pay = events.find((e) => e.type === 'pay');
  const open = pay && events.find((e) => e.type === 'open' && e.tab === pay.tab);
  const settle = pay && events.find((e) => e.type === 'settle' && e.tab === pay.tab);
  const callNo = pay && pay.price ? Number(BigInt(pay.amount ?? 0) / BigInt(pay.price)) : 0;
  const budget = open?.amount ? BigInt(open.amount) : undefined;
  const spent = BigInt(pay?.amount ?? 0);
  const pct = budget ? Math.min(100, Number((spent * 1000n) / (budget - 546n)) / 10) : 0;
  const fresh = pay && now - Date.parse(pay.at) < 15_000;
  const settleTx = settle?.txid;
  return (
    <div className={`relative min-w-0 self-start rounded-2xl border bg-panel/90 shadow-2xl backdrop-blur transition-colors ${fresh ? 'border-bch/60 shadow-bch/10' : 'border-line-2 shadow-bch/5'}`}>
      <div className="flex items-center gap-1.5 border-b border-line px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-white/10" /><span className="h-2.5 w-2.5 rounded-full bg-white/10" /><span className="h-2.5 w-2.5 rounded-full bg-white/10" />
        <span className="ml-3 truncate font-mono text-[11px] text-dim">{pay?.demo ? 'demo agent' : 'agent'} → {apiHost(net)}{pay?.route ?? '/api/oracle'}</span>
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
              <div className="text-[11px] uppercase tracking-wider text-dim">Running total</div>
              <div className="font-mono text-xl font-semibold">{sats(pay.amount)} <span className="text-sm text-muted">sats</span></div>
              {bchUsd && <div className="text-xs text-dim">{usd(spent, bchUsd)}</div>}
            </div>
          </div>
          {budget && (
            <div className="px-5 pt-3">
              <div className="h-1.5 overflow-hidden rounded-full bg-white/5"><div className="h-full rounded-full bg-gradient-to-r from-bch to-bch-2 transition-all duration-700" style={{ width: `${pct}%` }} /></div>
              <div className="mt-1 flex justify-between font-mono text-[11px] text-dim"><span>tab {sats(budget)} sats</span><span>{sats(budget - spent)} left on the tab</span></div>
            </div>
          )}
          <pre className="overflow-x-auto px-5 py-4 font-mono text-[12.5px] leading-6 text-muted">
<span className="text-fg">GET</span> {pay.route ?? '/api/oracle'}{'\n'}
<span className="text-warn">402 Payment Required</span>  scheme=<span className="text-fg">bch-credit</span> price=<span className="text-fg">{sats(pay.price)}</span>{'\n'}
<span className="text-fg">X-PAYMENT</span> voucher #{callNo} · total {sats(pay.amount)} · signed by agent{'\n'}
<span className="text-bch-2">200 OK</span>  <span className="text-dim">no transaction, no fee</span>{'\n'}
<span className="text-dim">────────────────────────────────────</span>{'\n'}
open   {open?.txid ? <a className="text-bch-2 hover:underline" href={explorerTx(net, open.txid)} target="_blank" rel="noreferrer">{short(open.txid, 8)} ↗</a> : <span className="text-dim">…</span>}{'\n'}
settle {settleTx ? <a className="text-bch-2 hover:underline" href={explorerTx(net, settleTx)} target="_blank" rel="noreferrer">{short(settleTx, 8)} ↗</a> : <span className="text-dim">provider settles any time</span>}
          </pre>
        </>
      ) : (
        <p className="px-5 py-10 font-mono text-sm text-dim">waiting for the first paid call…</p>
      )}
    </div>
  );
}

export function Hero({ events, stats, net, bchUsd, demoEnabled, preferTab, onFund }: {
  events: FeedEvent[]; stats: Stats | null; net: Net; bchUsd?: number; demoEnabled: boolean; preferTab?: string; onFund: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: true; r: DemoCall } | { ok: false; msg: string } | null>(null);
  async function runDemo() {
    setBusy(true); setResult(null);
    try { setResult({ ok: true, r: await api.demoCall(preferTab) }); } catch (e) { setResult({ ok: false, msg: (e as Error).message }); }
    setBusy(false);
  }
  return (
    <section className="relative overflow-hidden">
      <div className="grid-bg pointer-events-none absolute inset-0" />
      <div className="relative mx-auto grid max-w-6xl gap-10 px-4 pb-14 pt-10 md:grid-cols-[1.05fr_1fr] md:pt-16">
        <div className="min-w-0">
          <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-line-2 bg-panel px-3 py-1 text-xs text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-bch pulse-dot" /> Live on {net} · covenant-enforced
          </p>
          <h1 className="break-words text-[34px] sm:text-[38px] font-extrabold leading-[1.05] tracking-tight md:text-[54px]">
            Your AI agent just paid for its own API call.<span className="text-bch"> In Bitcoin Cash.</span>
          </h1>
          <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-muted">
            Open a <b className="text-fg">tab</b> for your agent: lock a budget in a BCH covenant once, and the agent pays per call
            with signed vouchers. No transaction per call and no custodian. The provider can only take what was signed. Whatever's left goes back to you.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            {demoEnabled && (
              <button onClick={runDemo} disabled={busy} className="rounded-xl bg-bch px-5 py-3 font-semibold text-ink transition hover:bg-bch-2 disabled:opacity-60">
                {busy ? 'Agent is paying…' : '▶ Run the demo agent'}
              </button>
            )}
            <button onClick={onFund} className={`rounded-xl px-5 py-3 font-semibold transition ${demoEnabled ? 'border border-line-2 text-fg hover:border-bch/60' : 'bg-bch text-ink hover:bg-bch-2'}`}>Fund your agent's tab</button>
            <a href="#how" className="rounded-xl px-3 py-3 font-semibold text-muted hover:text-fg">How it works →</a>
          </div>
          <div className="mt-3 min-h-[44px] text-sm">
            {result?.ok === true && (
              <p className="slide-in text-muted">
                <span className="text-bch-2">Paid {sats(result.r.priceSats)} sats</span> with voucher total {sats(result.r.cumulativeSats)}{preferTab && result.r.tab === preferTab ? ' from your tab' : ''}. Oracle said: <span className="text-fg">{result.r.answer}</span>
              </p>
            )}
            {result?.ok === false && <p className="text-warn">{result.msg.includes('rate') ? 'Easy, one call every few seconds.' : result.msg}</p>}
            {!result && demoEnabled && <p className="text-dim">The demo agent runs on our server and pays from its own tab{preferTab ? ', or from the tab you funded for it' : ''}. Watch the receipt and the feed.</p>}
          </div>
          <dl className="mt-6 grid max-w-md grid-cols-3 gap-3">
            {[
              ['paid calls', stats ? stats.paidCalls.toLocaleString() : '—', ''],
              ['sats vouched', stats ? sats(stats.vouchedSats) : '—', stats && bchUsd ? usd(BigInt(stats.vouchedSats), bchUsd) : ''],
              ['open tabs', stats ? String(stats.openTabs) : '—', ''],
            ].map(([k, v, sub]) => (
              <div key={k} className="rounded-xl border border-line bg-panel px-3 py-2.5">
                <dt className="text-[11px] uppercase tracking-wider text-dim">{k}</dt>
                <dd className="mt-0.5 font-mono text-lg font-semibold">{v}</dd>
                {sub && <dd className="text-[11px] text-dim">{sub}</dd>}
              </div>
            ))}
          </dl>
        </div>
        <Receipt events={events} net={net} bchUsd={bchUsd} />
      </div>
    </section>
  );
}
