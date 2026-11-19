import { useRef, type CSSProperties } from 'react';
import type { FeedEvent } from '../lib/api';
import { ago, sats, short, usd } from '../lib/format';
import { useCountUp } from '../lib/motion';
import { explorerTx, type Net } from '../config';
import { useNow } from './Feed';
import type { JourneyState } from './Journey';

type Status = 'waiting' | 'opening' | 'open' | 'settling' | 'settled' | 'waived' | 'paid';
interface View {
  label: string;
  who: string;
  at?: string;
  status: Status;
  budget?: bigint;
  calls: number;
  price?: bigint;
  route: string;
  spent: bigint;
  back?: bigint;
  openTxid?: string;
  closeTxid?: string;
  /** Journey only: rows still to come, and the coin animation. */
  pending?: number;
  coin?: boolean;
  direct?: boolean;
  /** Per-call route/price for the latest calls (feed tabs mix routes). */
  rows?: { route: string; price?: bigint }[];
}

const tabLabel = (id?: string) => (id ? `TAB #${id.slice(0, 4).toUpperCase()}` : 'TAB #----');

function journeyView(j: JourneyState, defaultPrice: bigint, route: string): View {
  const price = j.price ?? defaultPrice;
  const spent = j.spent ?? BigInt(j.calls) * price;
  const status: Status = j.done ? (j.action === 'cancel' ? 'waived' : 'settled')
    : !j.openTxid ? (j.step === 'open' ? 'opening' : 'waiting')
    : j.step === 'close' ? 'settling' : 'open';
  const settled = j.settled !== undefined ? BigInt(j.settled) : spent;
  return {
    label: tabLabel(j.openTxid), who: 'your tab', status, budget: j.budget, calls: j.calls, price, route: j.route ?? route,
    spent: j.done ? settled : spent, back: j.done && j.returned ? BigInt(j.returned) : undefined,
    openTxid: j.openTxid, closeTxid: j.closeTxid, pending: j.done || j.error ? 0 : Math.max(0, 3 - j.calls),
    coin: status === 'opening' || !!j.openTxid,
  };
}

function feedView(events: FeedEvent[], tab: string, mine: boolean): View {
  const pays = events.filter((e) => e.type === 'pay' && e.tab === tab).sort((a, b) => a.id - b.id);
  const open = events.find((e) => e.type === 'open' && e.tab === tab);
  const close = events.find((e) => (e.type === 'settle' || e.type === 'cancel') && e.tab === tab);
  const last = pays[pays.length - 1];
  const budget = open?.amount ? BigInt(open.amount) : undefined;
  const calls = pays.length || close?.calls || 0;
  const spent = close?.type === 'settle' ? BigInt(close.amount ?? 0) : BigInt(last?.amount ?? 0);
  const price = last?.price ? BigInt(last.price) : calls ? spent / BigInt(calls) : undefined;
  return {
    label: tabLabel(tab), who: mine ? 'your tab' : (last ?? open)?.demo ? 'house demo agent' : 'agent',
    at: (close ?? last ?? open)?.at, status: close ? (close.type === 'settle' ? 'settled' : 'waived') : 'open',
    budget, calls, price, route: last?.route ?? '/api/oracle', spent,
    back: close && budget !== undefined ? (close.type === 'settle' ? budget - spent : budget) : undefined,
    openTxid: open?.txid, closeTxid: close?.txid,
    rows: pays.length ? pays.slice(-3).map((p) => ({ route: p.route ?? '/api/oracle', price: p.price ? BigInt(p.price) : undefined })) : undefined,
  };
}

function directView(e: FeedEvent): View {
  const amt = BigInt(e.amount ?? 0);
  return { label: `PAYMENT #${e.tab.slice(7, 11).toUpperCase()}`, who: '1¢ direct pay', at: e.at, status: 'paid', calls: 1, price: amt,
    route: e.route ?? '/api/oracle', spent: amt, closeTxid: e.txid, direct: true };
}

/** Eight specks fly out from the centre of the parent (which must be position: relative). Hidden under reduced motion. */
function Burst({ delay = 0, reach = 22 }: { delay?: number; reach?: number }) {
  return (
    <span aria-hidden className="burst">
      {Array.from({ length: 8 }, (_, i) => (
        <i key={i} style={{ '--a': `${i * 45 + (i % 2 ? 12 : -8)}deg`, '--d': `${reach + (i % 3) * 6}px`, '--delay': `${delay + (i % 2) * 40}ms` } as CSSProperties} />
      ))}
    </span>
  );
}

const Spinner = () => <span aria-hidden className="spin inline-block h-3 w-3 shrink-0 rounded-full border-2 border-current border-r-transparent" />;

/** The receipt slip: the live stage for the run (and the latest real tab when nothing is running). */
export function Ticket({ events, net, bchUsd, journey, inJourney, tab, mine, waking, onTryChipnet, defaultPrice, route }: {
  events: FeedEvent[]; net: Net; bchUsd?: number; journey: JourneyState; inJourney: boolean; tab?: string; mine?: boolean;
  waking?: boolean; onTryChipnet?: () => void; defaultPrice: bigint; route: string;
}) {
  const now = useNow(1000);
  const direct = net === 'mainnet' ? events.find((e) => e.type === 'direct') : undefined;
  const v: View | undefined = inJourney ? journeyView(journey, defaultPrice, route)
    : tab ? feedView(events, tab, !!mine)
    : direct ? directView(direct) : undefined;

  const spentN = useCountUp(Number(v?.spent ?? 0n));
  // A payment "lands" when the call count goes up while this tab is on screen (not on first paint).
  // Tracked in a ref during render so the burst stays mounted (and plays once) through later re-renders.
  const seen = useRef<{ label?: string; calls: number; landed: number }>({ calls: 0, landed: 0 });
  if (v) {
    const c = seen.current;
    if (c.label !== v.label) c.landed = 0;
    else if (v.calls > c.calls) c.landed = v.calls;
    c.label = v.label; c.calls = v.calls;
  }
  const landed = seen.current.landed;
  const backN = useCountUp(Number(v?.back ?? (v?.budget !== undefined ? v.budget - v.spent : 0n)));

  if (!v) {
    return (
      <div id="ticket" className="slip min-w-0 scroll-mt-24 p-5 font-mono text-[12.5px]">
        <div className="flex justify-between text-[13px] font-semibold"><span className="tracking-[0.2em]">AGENTTAB</span><span>TAB #----</span></div>
        <div className="slip-tear my-4 -mx-1.5" />
        {waking || !onTryChipnet ? (
          <div aria-busy="true">
            <div className="grid gap-2.5">{[80, 64, 72, 50].map((w) => <div key={w} className="skeleton h-3.5" style={{ width: `${w}%` }} />)}</div>
            <p className="mt-4 flex items-center gap-2 font-sans text-sm text-muted"><Spinner />Waking the demo server (about 20 s)</p>
          </div>
        ) : (
          <p className="font-sans text-sm text-muted">No tabs on {net} yet.{' '}
            <button type="button" onClick={onTryChipnet} className="tap font-medium text-bch-2 hover:underline">See a live one on Chipnet →</button></p>
        )}
      </div>
    );
  }

  const closed = v.status === 'settled' || v.status === 'waived' || v.status === 'paid';
  const pct = v.budget ? Math.min(100, Number((v.spent * 1000n) / v.budget) / 10) : v.direct ? 100 : 0;
  const owner = v.who === 'your tab' ? 'you' : 'owner';
  const shown = Math.min(v.calls, 3);
  const lines = Array.from({ length: shown }, (_, i) => v.calls - shown + i + 1);
  const link = 'tap text-bch-2 hover:underline';
  const j = journey;

  const status = inJourney ? (
    j.error ? <span className="text-bad">{j.error}{j.openTxid ? ' Your tab is safe in the covenant.' : ''}</span>
    : j.hiccup ? <span className="flex items-center gap-2 text-warn"><Spinner />Server hiccup, retrying. Your 5¢ is safe in the covenant.</span>
    : v.status === 'waiting' ? <span className="flex items-center gap-2"><Spinner />{j.note ?? 'Getting a wallet ready…'}</span>
    : v.status === 'opening' ? <span className="flex items-center gap-2"><Spinner />{j.note ?? 'Opening the tab: 1 transaction'}</span>
    : v.status === 'open' ? <span className="flex items-center gap-2"><Spinner />{j.calls < 3 ? `Agent paying call ${j.calls + 1} of 3 · no transaction` : 'Calls done'}</span>
    : v.status === 'settling' ? <span className="flex items-center gap-2"><Spinner />Closing the tab: 1 transaction</span>
    : <span className="font-medium text-bch-2">Done: {sats(v.back)} sats came back to you.</span>
  ) : null;

  return (
    <div id="ticket" className="slip relative min-w-0 scroll-mt-24 font-mono text-[12.5px]" aria-live="polite">
      <div className="px-5 pt-4">
        <div className="flex items-center justify-between gap-3 text-[13px] font-semibold">
          <span className="tracking-[0.2em]">AGENTTAB</span>
          <span key={v.label} className="fade-in">{v.label}{inJourney && v.openTxid && !closed ? <span className="font-normal text-bch-2"> open</span> : ''}</span>
        </div>
        <div className="mt-1 flex items-center justify-between gap-3 text-[11.5px] text-dim">
          <span className={`truncate ${v.who === 'your tab' ? 'text-bch-2' : ''}`}>{v.who} · {net}</span>
          {v.at && <span className="whitespace-nowrap">{ago(v.at, now)}</span>}
        </div>
        {status && <div key={`${v.status}-${!!j.hiccup}-${!!j.error}`} className="fade-in mt-3 font-sans text-[13px] leading-snug text-muted">{status}</div>}
      </div>
      <div className="slip-tear my-3" />
      <div className="grid gap-1.5 px-5">
        {!v.direct && (
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-dim">
              {v.coin && <span key={v.openTxid ?? 'coin'} className="coin-in relative grid h-5 w-5 place-items-center rounded-full bg-bch font-sans text-[10px] font-bold text-on-bch">5¢{v.openTxid && <Burst delay={330} reach={18} />}</span>}
              locked in tab
            </span>
            <span className="text-right text-fg">{v.budget !== undefined ? `${sats(v.budget)} sats`
              : inJourney ? <span className="skeleton inline-block h-3 w-20 align-middle" />
              : <span className="text-dim" title="Opened before the feed window">—</span>}</span>
          </div>
        )}
        {inJourney && j.capped && v.budget !== undefined && (
          <p className="-mt-0.5 font-sans text-[11.5px] text-dim">Less than 20,000: capped to what your test wallet holds.</p>
        )}
        {v.calls > 3 && <div className="text-dim">+ {v.calls - 3} earlier calls</div>}
        {lines.map((n, i) => {
          const row = v.rows?.[v.rows.length - lines.length + i];
          const price = row?.price ?? v.price;
          return (
            <div key={`${v.label}-${n}`} className="slide-in flex items-center justify-between gap-3">
              <span className="truncate text-fg">{row?.route ?? v.route} <span className="text-dim">402 → </span><span className="text-bch-2">200</span></span>
              <span className="whitespace-nowrap text-fg">{price !== undefined ? `+${sats(price)}` : ''}</span>
            </div>
          );
        })}
        {Array.from({ length: v.pending ?? 0 }, (_, i) => (
          <div key={`p${i}`} className="flex items-center justify-between gap-3 text-dim/70"><span>call {v.calls + i + 1}</span><span>…</span></div>
        ))}
        <div className="flex items-center justify-between gap-3">
          <span className="text-dim">{v.direct ? 'on-chain txs' : 'on-chain txs for these calls'}</span>
          <span key={v.calls} className={`px-1 font-semibold text-fg ${v.direct ? '' : 'zero-pulse'}`}>{v.direct ? 1 : 0}</span>
        </div>
      </div>
      <div className="slip-tear my-3" />
      <div className="px-5">
        <div className="flex items-end justify-between gap-4">
          <span className="flex items-center gap-2.5 font-sans text-[13px] text-dim">{closed && !v.direct ? 'Total paid' : 'Total'}
            {closed && (
              <span key={`stamp-${v.label}`} className="stamp inline-block rounded border-2 border-bch-2 px-1.5 py-px font-mono text-[12px] font-bold tracking-[0.18em] text-bch-2">
                {v.status === 'settled' ? 'SETTLED' : v.status === 'waived' ? 'WAIVED' : 'PAID'}
              </span>
            )}
          </span>
          <span className="text-right"><span key={`land-${landed}`} className={`relative text-2xl font-bold tabular-nums text-fg ${landed ? 'land' : ''}`}>{spentN.toLocaleString('en-US')}{landed > 0 && <Burst reach={26} />}</span> <span className="text-muted">sats</span>
            {bchUsd ? <span className="block text-[11.5px] text-dim">{usd(BigInt(spentN), bchUsd)}</span> : null}</span>
        </div>
        {(v.budget !== undefined) && (
          <div className="mt-3">
            <div className="flex h-2 overflow-hidden rounded-full bg-subtle" role="img"
              aria-label={closed ? `provider ${sats(v.spent)} sats, ${sats(v.back)} back to ${owner}` : `${sats(v.spent)} of ${sats(v.budget)} sats spent`}>
              <div className="bar-seg h-full bg-bch" style={{ width: `${pct}%` }} />
              <div className={`bar-seg h-full ${closed ? 'bg-fg/25' : 'bg-transparent'}`} style={{ width: `${100 - pct}%`, marginLeft: closed && pct > 0 ? 2 : 0 }} />
            </div>
            <div className="mt-1.5 flex justify-between gap-2 text-[11.5px]">
              <span className={closed ? 'text-bch-2' : 'text-dim'}>{closed ? `provider ${sats(v.spent)}` : `${sats(v.spent)} spent`}</span>
              <span className={closed ? 'font-semibold text-fg' : 'text-dim'}>{closed ? `${backN.toLocaleString('en-US')} back to ${owner}` : `${backN.toLocaleString('en-US')} left`}</span>
            </div>
          </div>
        )}
      </div>
      <div className="slip-tear my-3" />
      <div className="flex flex-wrap items-center justify-between gap-x-4 px-5 pb-4 text-[11.5px]">
        {!v.direct && <span><span className="text-dim">open </span>{v.openTxid ? <a className={link} href={explorerTx(net, v.openTxid)} target="_blank" rel="noreferrer">{short(v.openTxid, 4)} ↗</a> : <span className="text-dim">{inJourney ? '…' : '—'}</span>}</span>}
        <span><span className="text-dim">{v.direct ? 'tx ' : v.status === 'waived' ? 'waive ' : 'settle '}</span>{v.closeTxid
          ? <a className={link} href={explorerTx(net, v.closeTxid)} target="_blank" rel="noreferrer">{short(v.closeTxid, 4)} ↗</a>
          : <span className="text-dim">on close</span>}</span>
      </div>
    </div>
  );
}
