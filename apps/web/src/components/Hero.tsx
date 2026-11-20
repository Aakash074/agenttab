import { sats } from '../lib/format';
import { useCountUp } from '../lib/motion';
import type { Net } from '../config';
import type { JourneyState } from './Journey';

export type DemoRun = { busy: boolean; at?: number; result?: { ok: true; r: import('../lib/api').DemoCall } | { ok: false; msg: string } };

const Spinner = () => <span aria-hidden className="spin inline-block h-3.5 w-3.5 shrink-0 rounded-full border-2 border-current border-r-transparent" />;

function Num({ n }: { n: number }) {
  const v = useCountUp(n, 400, 0);
  return <b className="font-semibold tabular-nums text-fg">{v.toLocaleString('en-US')}</b>;
}

/** Calls · on-chain txs on this network · cheats blocked (always on Chipnet), counting up as they change. */
export function ProofStrip({ net, calls, txs, attacks, onCheat }: {
  net: Net; calls?: number; txs?: number; attacks?: { rejected: number; total: number }; onCheat: () => void;
}) {
  const sk = <span className="skeleton inline-block h-3.5 w-5 align-middle" aria-label="loading" />;
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[15px] text-muted sm:gap-x-2.5">
      <span className="font-medium text-fg">On {net === 'mainnet' ? 'Mainnet' : 'Chipnet'}:</span>
      <span>{calls !== undefined ? <Num n={calls} /> : sk} calls paid by agents</span><span aria-hidden className="hidden text-line-2 sm:inline">·</span>
      <span>{txs !== undefined ? <Num n={txs} /> : sk} on-chain txs</span><span aria-hidden className="hidden text-line-2 sm:inline">·</span>
      <button type="button" onClick={onCheat} className="tap text-left underline decoration-line-2 underline-offset-4 hover:text-fg hover:decoration-bch">
        <span>{attacks ? <><Num n={attacks.rejected} /><b className="font-semibold text-fg">/{attacks.total}</b> cheats blocked</> : '7 cheats to try'}{net !== 'chipnet' ? ' on Chipnet' : ''}</span>
      </button>
    </p>
  );
}

/** Left column of the hero: status, headline, the one action. */
export function Hero({ net, waking, queued, journey, demoHere, direct, onStart, onResume, onTryChipnet, onHouse, houseBusy, walletTab }: {
  net: Net; waking?: boolean; apiDown?: boolean; queued?: boolean; journey: JourneyState;
  /** The free 5¢ demo runs on this network (chipnet). */
  demoHere: boolean;
  /** The 1¢ pay (mainnet), shown under the 5¢ tab. */
  direct: React.ReactNode;
  onStart: () => void; onResume: () => void; onTryChipnet: () => void;
  /** Runs one house-agent call (needs no visitor coins): the main action while the faucet is out. */
  onHouse?: () => void; houseBusy?: boolean;
  /** Mainnet: the 5¢ tab as the lead action, funded from the visitor's own wallet (WizardConnect only). */
  walletTab?: { calls: number; hint: string };
}) {
  const j = journey;
  const running = j.active;
  // Faucet empty or rate-limited, nothing of the visitor's on chain: lead with the house agent, keep "Try again" second.
  const house = !!onHouse && !!j.faucetOut && !running && !j.openTxid && !queued;
  const retryMin = j.retryAt && j.retryAt > Date.now() ? Math.ceil((j.retryAt - Date.now()) / 60_000) : 0;
  const label = queued ? 'Starting when the server wakes'
    : running ? (j.hiccup ? 'Reconnecting' : 'Running the demo')
    : j.error ? (j.openTxid ? 'Resume my tab' : 'Try again')
    : j.done ? 'Run it again' : 'Give an AI agent a 5¢ tab';
  return (
    <div className="min-w-0">
      <p className="mb-4 inline-flex items-center gap-2 text-sm text-muted">
        <span className={`h-2 w-2 rounded-full ${waking ? 'bg-dim' : 'bg-bch'} pulse-dot`} />
        {waking ? `Waking the ${net === 'mainnet' ? 'Mainnet' : 'Chipnet'} server` : net === 'mainnet' ? 'Live on Mainnet, real BCH' : 'Live on Chipnet, free test coins'}
      </p>
      <h1 className="text-[40px] font-extrabold leading-[1.04] tracking-[-0.025em] sm:text-[52px] lg:text-[58px]">A bar tab for AI&nbsp;agents.</h1>
      <p className="mt-4 max-w-md text-lg leading-relaxed text-muted">{demoHere
        ? 'Put 5¢ behind the bar once. Your agent pays per call, with no fee per call. Change comes back.'
        : 'Give your agent a 5¢ tab with change back, or pay 1¢ for one live answer.'}</p>
      <div className="mt-7">
        {demoHere ? (
          <div className="sm:max-w-lg">
            {house ? (
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                <button type="button" data-stream-src onClick={onHouse} disabled={houseBusy}
                  className="btn-primary flex min-h-[52px] w-full items-center justify-center gap-2.5 rounded-xl bg-bch px-6 text-base font-semibold text-on-bch hover:bg-bch-hover disabled:cursor-wait disabled:opacity-80 sm:w-auto">
                  {houseBusy && <Spinner />}{houseBusy ? 'The house agent is paying…' : 'Make the house agent pay now'}
                </button>
                <button type="button" onClick={onStart} disabled={retryMin > 0}
                  className="tap min-h-[44px] text-sm font-medium text-bch-2 hover:underline disabled:cursor-not-allowed disabled:text-dim disabled:no-underline">
                  {retryMin > 0 ? `Try again in ${retryMin} min` : 'Try again'}
                </button>
              </div>
            ) : (
            <button type="button" data-stream-src onClick={j.error && j.openTxid ? onResume : onStart} disabled={running || queued}
              className="btn-primary flex min-h-[52px] w-full items-center justify-center gap-2.5 rounded-xl bg-bch px-6 text-base font-semibold text-on-bch hover:bg-bch-hover disabled:cursor-wait disabled:opacity-80 sm:w-auto">
              {(running || queued) && <Spinner />}{label}
            </button>
            )}
            <p className="mt-2.5 min-h-[24px] text-sm text-muted" aria-live="polite">
              {waking && !running ? <span className="flex items-center gap-2"><Spinner />Waking the {net === 'mainnet' ? 'Mainnet' : 'Chipnet'} server (about 20 s).{queued ? ' Your run starts when it answers.' : ' You can press now.'}</span>
                : j.done && j.returned ? <>{j.total ?? 3} calls · 2 txs · <b className="text-fg">{sats(j.returned)} sats came back</b></>
                : house ? 'Free test coins are out for now. The house agent pays from its own tab, no coins needed.'
                : j.error ? (j.openTxid ? 'Your tab is safe in the covenant. Resume picks up where it stopped.' : 'Nothing was spent.')
                : 'About 40 seconds · 2 transactions · free test coins'}
            </p>
          </div>
        ) : (
          <>
            {/* Mainnet: the covenant tab leads; the 1¢ pay and the free Chipnet path sit under it. Same layout before and after the server wakes. */}
            {walletTab && (
              <div className="sm:max-w-lg">
                <button type="button" data-testid="wallet-tab" data-stream-src onClick={j.error && j.openTxid ? onResume : onStart} disabled={running || queued}
                  className="btn-primary flex min-h-[52px] w-full items-center justify-center gap-2.5 rounded-xl bg-bch px-6 text-base font-semibold text-on-bch hover:bg-bch-hover disabled:cursor-wait disabled:opacity-80 sm:w-auto">
                  {(running || queued) && <Spinner />}{label}{!running && !queued && <span aria-hidden>→</span>}
                </button>
                <p className="mt-2.5 min-h-[40px] text-sm text-muted" aria-live="polite">
                  {j.done && j.returned ? <>{j.calls} calls · 2 txs · <b className="text-fg">{sats(j.returned)} sats came back to your wallet</b></>
                    : j.error ? (j.openTxid ? 'Your tab is safe in the covenant. Resume picks up where it stopped.' : 'Nothing was spent.')
                    : running ? `${walletTab.calls} paid calls, then one settle tx returns the rest to you.`
                    : walletTab.hint}
                </p>
              </div>
            )}
            <div className={walletTab ? 'mt-3' : ''}>{direct}</div>
            <button type="button" onClick={onTryChipnet}
              className="tap mt-2 inline-flex min-h-[44px] items-center gap-1.5 text-[15px] font-semibold text-bch-2 hover:underline">
              Try it free on Chipnet (no wallet) <span aria-hidden>→</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
