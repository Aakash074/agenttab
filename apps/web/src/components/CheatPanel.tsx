import { useEffect, useState } from 'react';
import { api, type AttackRun } from '../lib/api';
import { ago, short } from '../lib/format';
import { explorerAddr, explorerTx, type Net } from '../config';

const PLANNED = [
  'Replay an old voucher', 'Provider overclaims', 'Provider rewrites the voucher amount', 'Send the remainder elsewhere',
  'Owner pulls the money early', 'Agent tries to withdraw', 'Provider "cancels" into its own wallet',
];

/** "Try to cheat the tab": real attacks on chipnet, with the node's verbatim rejection. */
export function CheatPanel({ net }: { net: Net }) {
  const [run, setRun] = useState<AttackRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [shown, setShown] = useState(99); // rows revealed (staggered after a fresh run)
  const [flash, setFlash] = useState(false);

  useEffect(() => { api.attacks().then((r) => setRun(r.last)).catch(() => {}); }, [net]);
  useEffect(() => {
    if (shown >= (run?.results.length ?? 0) + 1) return;
    const t = setTimeout(() => setShown((n) => n + 1), 380);
    return () => clearTimeout(t);
  }, [shown, run]);
  useEffect(() => { if (!flash) return; const t = setTimeout(() => setFlash(false), 2500); return () => clearTimeout(t); }, [flash]);

  async function go() {
    setBusy(true); setNote(null);
    try {
      const r = await api.runAttacks();
      if (r.last) { setRun(r.last); if (!r.cached) { setShown(0); setTimeout(() => setFlash(true), 380 * (r.last.results.length + 1)); } }
      if (r.cached) setNote(`Showing the run from ${ago(r.last!.at)}. A fresh run is available in ${Math.ceil((r.retryInMs ?? 0) / 1000)} s.`);
      if (r.running) setNote('Another visitor is running the attacks right now; results will appear here.');
    } catch (e) { setNote((e as Error).message); }
    setBusy(false);
  }

  const rejected = run?.results.filter((r) => r.outcome === 'rejected').length ?? 0;
  return (
    <section id="cheat" className="scroll-mt-24 mx-auto max-w-6xl px-4 pt-16">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Try to cheat the tab</h2>
          <p className="mt-2 max-w-2xl text-muted">
            Each run opens a fresh tab on chipnet and sends real cheating transactions at it. Each rejection below is the raw error string the chipnet node returned.
          </p>
        </div>
        <button onClick={go} disabled={busy}
          className="w-full rounded-xl bg-fg px-5 py-3 font-semibold text-panel transition hover:opacity-90 disabled:cursor-wait disabled:opacity-60 sm:w-auto">
          {busy ? 'Attacking chipnet… (~30 s)' : 'Run 7 attacks on chipnet'}
        </button>
      </div>
      {note && <p className="mt-3 text-sm text-dim">{note}</p>}
      {busy && (
        <div className="mt-6 overflow-hidden card rounded-2xl border border-line bg-panel" aria-busy="true">
          <div className="border-b border-line px-5 py-3 text-xs text-dim">Opening a fresh tab on chipnet and paying 2 calls, then attacking…</div>
          <ol className="divide-y divide-line">
            {PLANNED.map((t, i) => (
              <li key={t} className="flex items-center justify-between gap-4 px-5 py-4">
                <span className="flex items-center gap-2"><span className="font-mono text-xs text-dim">0{i + 1}</span><span className="font-semibold text-muted">{t}</span></span>
                <span className="flex items-center gap-2 font-mono text-[11px] text-dim"><span className="h-2 w-2 rounded-full bg-warn pulse-dot" />attacking</span>
              </li>
            ))}
          </ol>
        </div>
      )}
      {!busy && run ? (<>
        <div className="mt-6 flex items-baseline gap-3">
          <span className={`font-mono text-5xl font-bold text-fg transition-transform ${flash ? 'scale-110' : ''}`}>{rejected}/{run.results.length}</span>
          <span className="text-lg font-semibold text-muted">attacks rejected</span>
        </div>
        <div className="mt-4 overflow-hidden card rounded-2xl border border-line bg-panel">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3 text-xs text-dim">
            <span><b className={`text-bch-2 transition-all ${flash ? 'rounded bg-bch/20 px-2 py-1 text-base' : ''}`}>{rejected}/{run.results.length} rejected</b> · run {ago(run.at)} · {Math.round(run.ms / 1000)} s</span>
            <span className="font-mono">
              tab <a className="tap text-bch-2 hover:underline" href={explorerTx(net, run.openTxid)} target="_blank" rel="noreferrer">{short(run.openTxid, 6)} ↗</a>
              {' · '}covenant <a className="tap hover:text-bch-2" href={explorerAddr(net, run.contract)} target="_blank" rel="noreferrer">{short(run.contract.split(':')[1] ?? run.contract, 6)} ↗</a>
            </span>
          </div>
          <ol className="divide-y divide-line">
            {run.results.map((r, i) => i >= shown ? (
              <li key={r.id} className="flex items-center justify-between gap-4 px-5 py-4">
                <span className="flex items-center gap-2"><span className="font-mono text-xs text-dim">0{i + 1}</span><span className="font-semibold text-muted">{r.title}</span></span>
                <span className="font-mono text-[11px] text-dim">…</span>
              </li>
            ) : (
              <li key={r.id} className="slide-in grid gap-2 px-5 py-4 sm:grid-cols-[1.1fr_1.4fr] sm:gap-6">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-dim">0{i + 1}</span>
                    <h3 className="font-semibold">{r.title}</h3>
                  </div>
                  <p className="mt-1 text-sm text-muted">{r.attempt}</p>
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-wider ${r.outcome === 'rejected' ? 'bg-bad/15 text-bad' : 'bg-warn/20 text-warn'}`}>
                      {r.outcome === 'rejected' ? 'REJECTED' : 'ACCEPTED'}
                    </span>
                    <span className="text-[11px] uppercase tracking-wider text-dim">by the {r.layer}</span>
                  </div>
                  <code className="mt-1.5 block break-words rounded-lg bg-ink px-3 py-2 font-mono text-[12px] leading-5 text-muted">{r.message}</code>
                  {r.attemptedTxid && <p className="mt-1 font-mono text-[11px] text-dim">attempted tx {short(r.attemptedTxid, 8)} · never entered the mempool</p>}
                </div>
              </li>
            ))}
            {shown > run.results.length && (
            <li className="slide-in grid gap-2 bg-bch/[0.05] px-5 py-4 sm:grid-cols-[1.1fr_1.4fr] sm:gap-6">
              <div>
                <h3 className="font-semibold text-bch-2">The honest settle</h3>
                <p className="mt-1 text-sm text-muted">Provider claims exactly the highest signed voucher; the covenant sends the rest back to the owner.</p>
              </div>
              <div className="flex items-center">
                {run.honestSettleTxid
                  ? <a className="tap font-mono text-sm text-bch-2 hover:underline" href={explorerTx(net, run.honestSettleTxid)} target="_blank" rel="noreferrer">accepted · {short(run.honestSettleTxid, 10)} ↗</a>
                  : <span className="text-sm text-dim">pending</span>}
              </div>
            </li>
            )}
          </ol>
        </div>
      </>) : !busy && (
        <p className="mt-6 card rounded-2xl border border-line bg-panel px-5 py-8 text-center text-sm text-muted">No attack run yet. Press the button to try.</p>
      )}
    </section>
  );
}
