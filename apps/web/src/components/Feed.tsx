import { useEffect, useRef, useState } from 'react';
import type { FeedEvent } from '../lib/api';
import { ago, sats, short } from '../lib/format';
import { explorerTx, SERVERS, type Net } from '../config';

export function useNow(ms = 5000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

const DOT: Record<FeedEvent['type'], string> = {
  pay: 'bg-bch', open: 'border-2 border-bch bg-panel', settle: 'bg-fg', cancel: 'border-2 border-fg bg-panel',
  expired: 'bg-line-2', closed: 'bg-line-2', direct: 'bg-fg',
};

/** One short line per event. */
export function describe(e: FeedEvent, mine: boolean, budget?: bigint) {
  const who = mine ? 'Your agent' : e.tag === 'attack' ? 'Attack test' : e.demo ? 'House agent' : 'An agent';
  const owner = mine ? 'you' : 'owner';
  switch (e.type) {
    case 'open': return <>{mine ? 'You' : e.tag === 'attack' ? 'Attack test' : 'Owner'} opened a <b className="font-semibold text-fg">{sats(e.amount)}</b>-sat tab</>;
    case 'pay': return <>{who} paid <b className="font-semibold text-fg">{sats(e.price)} sats</b> <span className="text-dim">for</span> <code className="font-mono text-[12.5px]">{e.route}</code></>;
    case 'settle': return <>Settled <b className="font-semibold text-fg">{sats(e.amount)}</b>{budget !== undefined ? <>, {sats(budget - BigInt(e.amount ?? 0))} back to {owner}</> : <>, rest back to {owner}</>}</>;
    case 'cancel': return <>Tab waived, all back to {owner}</>;
    case 'expired': return <>Tab timed out with nothing to settle</>;
    case 'closed': return <>{mine ? 'You' : 'Owner'} reclaimed the tab</>;
    case 'direct': return <>Someone paid <b className="font-semibold text-fg">{sats(e.amount)} sats</b> on-chain for a BCH price</>;
  }
}

const VISIBLE = 5;

/** Recent real Chipnet events, polled straight from the Chipnet API (used while the page is on Mainnet). */
function useChipnetPeek(on: boolean) {
  const [rows, setRows] = useState<FeedEvent[] | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    if (!on || !SERVERS.chipnet) return;
    let stop = false;
    const load = () => {
      if (document.hidden) return;
      fetch(`${SERVERS.chipnet}/feed?limit=12`, { signal: AbortSignal.timeout(45_000) }).then((r) => r.json())
        .then((f: { events?: FeedEvent[] }) => { if (!stop) { setRows((f.events ?? []).slice(0, 4)); setErr(false); } })
        .catch(() => !stop && setErr(true));
    };
    load();
    const t = setInterval(load, 15_000);
    return () => { stop = true; clearInterval(t); };
  }, [on]);
  return { rows, err };
}

function Row({ e, net, now, mine, budget, fresh }: { e: FeedEvent; net: Net; now: number; mine: boolean; budget?: bigint; fresh?: boolean }) {
  return (
    <li title={e.restored ? 'Recovered from the chain after a server restart' : undefined}
      className={`flex items-center gap-3 px-4 py-2.5 text-[14px] sm:px-5 ${fresh ? 'row-new' : ''} ${mine ? 'shadow-[inset_3px_0_0_var(--color-bch)]' : ''}`}>
      <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${DOT[e.type]}`} />
      <span className="min-w-0 flex-1 text-muted line-clamp-2 sm:line-clamp-none sm:truncate">{describe(e, mine, budget)}</span>
      <span className="hidden shrink-0 whitespace-nowrap text-xs text-dim sm:inline">
        {e.txid ? <a className="text-bch-2 hover:underline" href={explorerTx(net, e.txid)} target="_blank" rel="noreferrer">tx {short(e.txid, 3)} ↗</a> : e.type === 'pay' ? <span className="chip-tx is-zero !h-5">0 tx · 0 fee</span> : ''}
      </span>
      <time className="w-14 shrink-0 text-right text-xs text-dim">{e.timeUnknown ? 'recent' : ago(e.at, now).replace(' ago', '')}</time>
    </li>
  );
}

/** On Mainnet (little traffic so far): the real, labelled Chipnet activity under the Mainnet rows. */
function ChipnetPeek({ now, onOpen }: { now: number; onOpen?: () => void }) {
  const { rows, err } = useChipnetPeek(true);
  if (err && !rows) return null;
  return (
    <div className="border-t border-line bg-[color-mix(in_oklab,var(--color-bch)_4%,transparent)]">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-1 pt-3 sm:px-5">
        <span className="text-[13px] font-medium text-fg">
          <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-bch align-middle pulse-dot" />Meanwhile on Chipnet{' '}
          <span className="block pl-3.5 font-normal text-dim sm:inline sm:pl-0">test network, same covenant</span>
        </span>
        {onOpen && <button type="button" onClick={onOpen} className="tap text-[13px] font-medium text-bch-2 hover:underline">Open the Chipnet feed →</button>}
      </div>
      {rows === null ? (
        <div className="grid gap-2.5 px-4 py-3 sm:px-5" aria-busy="true">{[70, 55, 62].map((w) => <div key={w} className="skeleton h-3.5" style={{ width: `${w}%` }} />)}</div>
      ) : rows.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted sm:px-5">No Chipnet activity yet.</p>
      ) : (
        <ol className="divide-y divide-line/70">{rows.map((e) => <Row key={e.id} e={e} net="chipnet" now={now} mine={false} />)}</ol>
      )}
    </div>
  );
}

export function Feed({ events, net, live, mine, waking, onTryChipnet, action }: {
  events: FeedEvent[]; net: Net; live: boolean; mine?: Set<string>; waking?: boolean;
  /** Set on networks without the demo agent (mainnet): point to the chipnet history. */
  onTryChipnet?: () => void;
  /** Optional control in the header (e.g. "make the house agent pay now"). */
  action?: React.ReactNode;
}) {
  const now = useNow();
  const [all, setAll] = useState(false);
  // Rows that arrive after the first render slide in with a brief highlight; the initial list doesn't.
  const seen = useRef<Set<number> | null>(null);
  const fresh = new Set<number>();
  if (seen.current === null) { if (events.length) seen.current = new Set(events.map((e) => e.id)); }
  else for (const e of events) if (!seen.current.has(e.id)) fresh.add(e.id);
  useEffect(() => { if (seen.current) for (const e of events) seen.current.add(e.id); else if (events.length) seen.current = new Set(events.map((e) => e.id)); }, [events]);

  const budgets = new Map(events.filter((e) => e.type === 'open').map((e) => [e.tab, BigInt(e.amount ?? 0)]));
  const shown = all ? events : events.slice(0, VISIBLE);
  const idle = events[0] && !events[0].timeUnknown && now - Date.parse(events[0].at) > 90_000;
  return (
    <section id="feed" className="scroll-mt-24 card rounded-2xl border border-line bg-panel">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
        <span className="flex items-center gap-2 text-sm text-muted">
          <span className={`h-2 w-2 rounded-full ${live ? 'bg-bch pulse-dot' : 'bg-dim'}`} />
          {waking ? `Waking the ${net === 'mainnet' ? 'Mainnet' : 'Chipnet'} server` : idle ? `${net === 'mainnet' ? 'Mainnet' : 'Chipnet'} · last payment ${ago(events[0].at, now)}` : live ? `Streaming from ${net}` : `Polling ${net}`}
        </span>
        {action}
      </header>
      {events.length === 0 ? (
        <div className="px-5 py-10 text-center text-sm text-muted">
          {waking ? <p className="flex items-center justify-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-bch pulse-dot" />Waking the {net === 'mainnet' ? 'Mainnet' : 'Chipnet'} server (about 20 s)</p>
            : <p>No payments on {net} yet.</p>}
          {onTryChipnet && net !== 'mainnet' && <button type="button" onClick={onTryChipnet} className="tap mt-1 font-medium text-bch-2 hover:underline">See the live feed on Chipnet →</button>}
        </div>
      ) : (
        <>
          <ol className={`divide-y divide-line ${all ? 'max-h-[480px] overflow-y-auto' : ''}`}>
            {shown.map((e) => <Row key={e.id} e={e} net={net} now={now} mine={!!mine?.has(e.tab)} budget={budgets.get(e.tab)} fresh={fresh.has(e.id)} />)}
          </ol>
          {events.length > VISIBLE && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-1.5 text-[13px] sm:px-5">
              <button onClick={() => setAll((v) => !v)} className="tap font-medium text-muted hover:text-fg">{all ? 'Show latest only' : `Show all ${events.length}`}</button>
            </div>
          )}
        </>
      )}
      {net === 'mainnet' && !waking && <ChipnetPeek now={now} onOpen={onTryChipnet} />}
    </section>
  );
}
