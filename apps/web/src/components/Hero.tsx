import type { FeedEvent, Stats } from '../lib/api';
import { ago, sats, short } from '../lib/format';
import { explorerTx, type Net } from '../config';
import { useNow } from './Feed';

function Receipt({ events, net }: { events: FeedEvent[]; net: Net }) {
  const now = useNow(1000);
  const pay = events.find((e) => e.type === 'pay');
  const open = pay && events.find((e) => e.type === 'open' && e.tab === pay.tab);
  const settle = events.find((e) => e.type === 'settle');
  const callNo = pay && pay.price ? Number(BigInt(pay.amount ?? 0) / BigInt(pay.price)) : 0;
  return (
    <div className="relative rounded-2xl border border-line-2 bg-panel/90 shadow-2xl shadow-bch/5 backdrop-blur">
      <div className="flex items-center gap-1.5 border-b border-line px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-white/10" /><span className="h-2.5 w-2.5 rounded-full bg-white/10" /><span className="h-2.5 w-2.5 rounded-full bg-white/10" />
        <span className="ml-3 font-mono text-[11px] text-dim">agent ↔ api.example · last paid call</span>
        {pay && <span className="ml-auto text-[11px] text-dim">{ago(pay.at, now)}</span>}
      </div>
      <pre className="overflow-x-auto px-4 py-4 font-mono text-[12.5px] leading-6 text-muted">
{pay ? (
<>
<span className="text-dim"># 1. the API asks for money</span>{'\n'}
<span className="text-fg">GET</span> {pay.route ?? '/api/oracle'}{'\n'}
<span className="text-warn">402 Payment Required</span>  scheme=<span className="text-fg">bch-credit</span> price=<span className="text-fg">{sats(pay.price)} sats</span>{'\n\n'}
<span className="text-dim"># 2. the agent signs a voucher on its tab (no tx, ~1 ms)</span>{'\n'}
<span className="text-fg">X-PAYMENT</span> tab={short(pay.tab.split(':')[0], 4)} call=#{callNo} total=<span className="text-fg">{sats(pay.amount)} sats</span>{'\n'}
<span className="text-bch-2">200 OK</span>  answer delivered{'\n\n'}
<span className="text-dim"># 3. on-chain: tab funded once, settled once</span>{'\n'}
open   {open?.txid ? <a className="text-bch-2 hover:underline" href={explorerTx(net, open.txid)} target="_blank" rel="noreferrer">{short(open.txid, 8)}</a> : '…'}{'\n'}
settle {settle?.txid ? <a className="text-bch-2 hover:underline" href={explorerTx(net, settle.txid)} target="_blank" rel="noreferrer">{short(settle.txid, 8)}</a> : <span className="text-dim">pending: provider settles any time</span>}
</>
) : (
<span className="text-dim">waiting for the first paid call…</span>
)}
      </pre>
    </div>
  );
}

export function Hero({ events, stats, net, onFund }: { events: FeedEvent[]; stats: Stats | null; net: Net; onFund: () => void }) {
  return (
    <section className="relative overflow-hidden">
      <div className="grid-bg pointer-events-none absolute inset-0" />
      <div className="relative mx-auto grid max-w-6xl gap-10 px-4 pb-14 pt-12 md:grid-cols-[1.05fr_1fr] md:pt-20">
        <div>
          <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-line-2 bg-panel px-3 py-1 text-xs text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-bch pulse-dot" /> Live on {net} · covenant-enforced
          </p>
          <h1 className="text-[40px] font-extrabold leading-[1.05] tracking-tight md:text-[56px]">
            Your AI agent just paid for its own API call.<span className="text-bch"> In Bitcoin Cash.</span>
          </h1>
          <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-muted">
            Open a <b className="text-fg">tab</b> for your agent: lock a budget in a BCH covenant once, and the agent pays per call
            with signed vouchers. No transaction per call and no custodian. The provider can only take what was signed. Whatever's left goes back to you.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <button onClick={onFund} className="rounded-xl bg-bch px-5 py-3 font-semibold text-ink transition hover:bg-bch-2">Fund your agent's tab</button>
            <a href="#how" className="rounded-xl border border-line-2 px-5 py-3 font-semibold text-fg transition hover:border-bch/60">How it works</a>
          </div>
          <dl className="mt-10 grid max-w-md grid-cols-3 gap-4">
            {[
              ['paid calls', stats ? stats.paidCalls.toLocaleString() : '—'],
              ['sats vouched', stats ? sats(stats.vouchedSats) : '—'],
              ['open tabs', stats ? String(stats.openTabs) : '—'],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl border border-line bg-panel px-3 py-2.5">
                <dt className="text-[11px] uppercase tracking-wider text-dim">{k}</dt>
                <dd className="mt-0.5 font-mono text-lg font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
        <Receipt events={events} net={net} />
      </div>
    </section>
  );
}
