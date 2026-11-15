import { explorerTx, type Net } from '../config';
import { sats, short, usd } from '../lib/format';

export type JourneyStep = 'wallet' | 'coins' | 'open' | 'calls' | 'close';
export interface JourneyState {
  active: boolean;
  step?: JourneyStep;
  error?: string;
  budget?: bigint;
  openTxid?: string;
  calls: number;
  closeTxid?: string;
  returned?: string;
  action?: 'settle' | 'cancel';
  done?: boolean;
  /** Live progress text under the current step (e.g. "Getting free test coins… 4 s"). */
  note?: string;
}

export const IDLE_JOURNEY: JourneyState = { active: false, calls: 0 };

const STEPS: { id: JourneyStep; label: string }[] = [
  { id: 'wallet', label: 'Connect a wallet' },
  { id: 'coins', label: 'Have a few cents of BCH' },
  { id: 'open', label: 'Open the tab (1 transaction)' },
  { id: 'calls', label: 'AI agent pays 3 API calls (no transactions)' },
  { id: 'close', label: 'Close the tab, get your change (1 transaction)' },
];

/** The one-button judge path: connect → open → 3 paid calls → close → change back. */
export function Journey({ j = IDLE_JOURNEY, net, bchUsd, onStart, onReset, disabledReason, waking, wakeLong, queued }: {
  j?: JourneyState; net: Net; bchUsd?: number; onStart: () => void; onReset: () => void; disabledReason?: string;
  /** The API has not answered for a few seconds (free hosting waking up): pressing the button queues the run. */
  waking?: boolean; wakeLong?: boolean; queued?: boolean;
}) {
  const idx = j.step ? STEPS.findIndex((s) => s.id === j.step) : -1;
  if (!j.active && !j.done && !j.error) {
    return (
      <div className="sm:max-w-xl">
        <button onClick={onStart} disabled={!!disabledReason} title={disabledReason}
          className="min-h-[48px] w-full rounded-xl bg-bch px-6 text-base font-semibold text-on-bch transition hover:bg-bch-hover disabled:cursor-wait disabled:opacity-60 sm:w-auto">
          {disabledReason ? disabledReason : 'Give an AI agent a 5¢ tab'}
        </button>
        {waking ? (
          <p className="mt-2 flex items-start gap-2 text-sm text-muted" role="status">
            <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-bch pulse-dot" />
            <span>{wakeLong ? `The ${net} server is taking longer than usual to wake. Still retrying every few seconds.` : `Waking the ${net} server (~30 s)… It sleeps when nobody is using it and this page retries on its own.`}{queued ? ' Your run starts as soon as it answers.' : ' You can press the button now; the run starts when it answers.'}</span>
          </p>
        ) : (
          <p className="mt-2 text-sm text-muted">Watch it pay 3 API calls, then get your change back. About 30 seconds{net === 'chipnet' ? ', free test coins' : ', with your wallet'}.</p>
        )}
      </div>
    );
  }
  return (
    <div className="card w-full rounded-2xl border border-line-2 bg-panel p-4 sm:max-w-xl" aria-live="polite">
      {j.openTxid && <div className="mb-2 font-mono text-[11px] text-dim">{j.done ? 'Last run' : 'This run'} · tab #{j.openTxid.slice(0, 4).toUpperCase()}</div>}
      <ol className="grid gap-2">
        {STEPS.map((s, i) => {
          const state = j.done || i < idx ? 'done' : i === idx ? (j.error ? 'error' : 'now') : 'todo';
          return (
            <li key={s.id} className="flex items-start gap-3 text-sm">
              <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold ${
                state === 'done' ? 'bg-bch text-on-bch' : state === 'now' ? 'border-2 border-bch text-bch-2 pulse-dot' : state === 'error' ? 'bg-bad text-white' : 'border border-line-2 text-dim'}`}>
                {state === 'done' ? '✓' : state === 'error' ? '!' : i + 1}
              </span>
              <div className="min-w-0">
                <span className={state === 'todo' ? 'text-dim' : 'text-fg'}>{s.label}</span>
                {s.id === 'open' && j.openTxid && (
                  <a className="tap ml-2 font-mono text-xs text-bch-2 hover:underline" href={explorerTx(net, j.openTxid)} target="_blank" rel="noreferrer">
                    {j.budget ? `${sats(j.budget)} sats${bchUsd ? ` (${usd(j.budget, bchUsd)})` : ''} · ` : ''}{short(j.openTxid, 5)} ↗
                  </a>
                )}
                {s.id === 'calls' && (state === 'now' || state === 'done') && <span className="ml-2 font-mono text-xs text-muted">{j.calls}/3 paid · 0 transactions · 0 fees</span>}
                {state === 'now' && j.note && <span className="block text-xs text-dim">{j.note}</span>}
                {s.id === 'close' && j.closeTxid && (
                  <a className="tap ml-2 font-mono text-xs text-bch-2 hover:underline" href={explorerTx(net, j.closeTxid)} target="_blank" rel="noreferrer">{short(j.closeTxid, 5)} ↗</a>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {j.error && <p className="mt-3 rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">{j.error}</p>}
      {j.done && j.returned && (
        <p className="slide-in mt-3 rounded-lg border border-bch/30 bg-bch/10 px-3 py-2.5 text-sm">
          <b className="text-bch-2">Change back: {sats(j.returned)} sats</b>{bchUsd ? ` (${usd(BigInt(j.returned), bchUsd)})` : ''}.{' '}
          {j.action === 'settle' ? 'The provider took exactly what the agent signed for, and the covenant forced the rest back to you.' : 'The provider waived the tab and everything came back to you.'}
          {' '}3 API calls, 2 transactions.
        </p>
      )}
      {(j.done || j.error) && (
        <button onClick={onReset} className="mt-3 min-h-[44px] rounded-lg border border-line-2 px-4 text-sm font-medium text-fg hover:bg-subtle">{j.error ? 'Try again' : 'Do it again'}</button>
      )}
    </div>
  );
}
