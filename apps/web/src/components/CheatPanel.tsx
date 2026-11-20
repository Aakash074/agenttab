import { useEffect, useState } from 'react';
import { api, humanError, isTransient, type AttackRun } from '../lib/api';
import { ago, short } from '../lib/format';
import { reducedMotion, useCountUp } from '../lib/motion';
import { explorerAddr, explorerTx, type Net } from '../config';

const PLANNED = [
  'Replay an old voucher', 'Provider overclaims', 'Provider rewrites the voucher amount', 'Send the remainder elsewhere',
  'Owner pulls the money early', 'Agent tries to withdraw', 'Provider "cancels" into its own wallet',
];
const STAGGER = 120; // ms between attack rows flipping to their verdict (off under reduced motion)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** "Try to cheat it": real cheating transactions sent at a fresh chipnet tab; the node's verbatim rejection per row. */
export function CheatPanel({ net, onResult }: { net: Net; onResult?: (run: AttackRun) => void }) {
  const [run, setRun] = useState<AttackRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [shown, setShown] = useState(99); // rows revealed (staggered after a fresh run)

  useEffect(() => {
    let stop = false;
    (async () => {
      for (let i = 0; i < 6 && !stop; i++) {
        try { const r = await api.attacks(); if (!stop && r.last) { setRun(r.last); onResult?.(r.last); } return; }
        catch { await sleep(3000 * (i + 1)); }
      }
    })();
    return () => { stop = true; };
  }, [net]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!run || shown > run.results.length) return;
    const t = setTimeout(() => setShown((n) => n + 1), STAGGER);
    return () => clearTimeout(t);
  }, [shown, run]);

  async function go() {
    setBusy(true); setNote(null);
    try {
      let r;
      for (let i = 0; ; i++) {
        try { r = await api.runAttacks(); break; }
        catch (e) { if (!isTransient(e) || i >= 3) throw e; setNote('The chipnet server hiccuped. Retrying…'); await sleep(3000 * (i + 1)); }
      }
      setNote(null);
      if (r.last) { setRun(r.last); onResult?.(r.last); setShown(reducedMotion() ? 99 : 0); }
      if (r.cached) setNote(`Showing the run from ${ago(r.last!.at)}. A fresh one is available in ${Math.ceil((r.retryInMs ?? 0) / 1000)} s.`);
      if (r.running) setNote('Another visitor is running the attacks right now. Results appear here.');
    } catch (e) { setNote(`${humanError(e)} Try again in a moment.`); }
    setBusy(false);
  }

  const total = run?.results.length ?? 7;
  const revealed = run ? Math.min(shown, run.results.length) : 0;
  const rejected = run ? run.results.slice(0, revealed).filter((r) => r.outcome === 'rejected').length : 0;
  const count = useCountUp(busy ? 0 : rejected, 200);
  return (
    <div id="cheat" className="scroll-mt-24">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-baseline gap-3">
          {!run && !busy ? <span className="text-3xl font-bold">7 cheats to try</span> : <>
          <span className="font-mono text-5xl font-bold tabular-nums">{busy ? '–' : count}/{total}</span>
          <span className="text-lg font-semibold text-muted">cheats blocked</span></>}
        </div>
        <button onClick={go} disabled={busy}
          className="btn-primary flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-bch px-6 font-semibold text-on-bch hover:bg-bch-hover disabled:cursor-wait disabled:opacity-70 sm:w-auto">
          {busy && <span aria-hidden className="spin inline-block h-3.5 w-3.5 rounded-full border-2 border-current border-r-transparent" />}
          {busy ? 'Attacking chipnet (about 15 s)' : run ? 'Run the 7 attacks again' : 'Run the 7 attacks'}
        </button>
      </div>
      <p className="mt-2 max-w-2xl text-sm text-muted">Each run tries 7 cheats against a fresh chipnet tab: 6 real cheating transactions that the node must reject, and 1 replayed voucher that the paywall server must refuse. Open a row for the verbatim reply.</p>
      {note && <p className="mt-2 text-sm text-warn" role="status">{note}</p>}
      <ol className="mt-4 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-panel card">
        {busy || !run ? PLANNED.map((t, i) => (
          <li key={t} className="flex min-h-[48px] items-center justify-between gap-3 px-4 py-2.5 sm:px-5">
            <span className="flex min-w-0 items-center gap-3"><span className="font-mono text-xs text-dim">{i + 1}</span><span className="text-muted sm:truncate">{t}</span></span>
            <span className="flex shrink-0 items-center gap-2 text-xs text-dim">{busy && <span className="h-1.5 w-1.5 rounded-full bg-warn pulse-dot" />}{busy ? 'trying' : ''}</span>
          </li>
        )) : run.results.map((r, i) => (
          <li key={r.id}>
            <details className="group">
              <summary className="flex min-h-[48px] cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 hover:bg-subtle sm:px-5">
                <span className="flex min-w-0 items-center gap-3"><span className="font-mono text-xs text-dim">{i + 1}</span><span className="font-medium leading-snug sm:truncate">{r.title}</span></span>
                {i < shown ? (
                  <span key="done" className="fade-in flex shrink-0 items-center gap-2">
                    {/* Blocked = the covenant worked: accent, not red. Red is kept for a cheat that got through. */}
                    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-semibold ${r.outcome === 'rejected' ? 'bg-bch/10 text-bch-2' : 'bg-bad/10 text-bad'}`}>
                      {r.outcome === 'rejected' && <svg aria-hidden viewBox="0 0 12 12" fill="none" className="h-3 w-3"><path d="m2.5 6.2 2.3 2.3 4.7-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                      {r.outcome === 'rejected' ? `Blocked by ${/node/i.test(r.layer) ? 'node' : 'server'}` : 'Got through'}
                    </span>
                    <svg aria-hidden viewBox="0 0 12 12" fill="none" className="h-3 w-3 shrink-0 text-dim transition-transform group-open:rotate-180"><path d="M2.75 4.5 6 7.75 9.25 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </span>
                ) : <span className="flex items-center gap-2 text-xs text-dim"><span className="h-1.5 w-1.5 rounded-full bg-warn pulse-dot" />trying</span>}
              </summary>
              <div className="grid gap-2 px-4 pb-4 sm:px-5 sm:pl-12">
                <p className="text-sm text-muted">{r.attempt}</p>
                <code className="block break-words rounded-lg bg-ink px-3 py-2 font-mono text-[12px] leading-5 text-muted">{r.message}</code>
                {r.attemptedTxid && <p className="font-mono text-[11.5px] text-dim">attempted tx {short(r.attemptedTxid, 8)} · never entered the mempool</p>}
              </div>
            </details>
          </li>
        ))}
        {run && !busy && shown > run.results.length && (
          <li className="fade-in flex flex-wrap items-center justify-between gap-2 bg-bch/[0.06] px-4 py-3 text-sm sm:px-5">
            <span><b className="text-bch-2">The honest settle</b> <span className="text-muted">was accepted: the provider got exactly what was signed.</span></span>
            {run.honestSettleTxid && <a className="tap font-mono text-xs text-bch-2 hover:underline" href={explorerTx(net, run.honestSettleTxid)} target="_blank" rel="noreferrer">{short(run.honestSettleTxid, 5)} ↗</a>}
          </li>
        )}
      </ol>
      {run && !busy && (
        <p className="mt-2 font-mono text-[11.5px] text-dim">
          run {ago(run.at)} · {Math.round(run.ms / 1000)} s · tab <a className="tap text-bch-2 hover:underline" href={explorerTx(net, run.openTxid)} target="_blank" rel="noreferrer">{short(run.openTxid, 4)} ↗</a>
          {' · '}covenant <a className="tap text-bch-2 hover:underline" href={explorerAddr(net, run.contract)} target="_blank" rel="noreferrer">{short(run.contract.split(':')[1] ?? run.contract, 4)} ↗</a>
        </p>
      )}
    </div>
  );
}
