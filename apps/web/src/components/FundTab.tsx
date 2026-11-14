import { useEffect, useState } from 'react';
import { BUDGETS, CONTRACT_SOURCE_URL, DURATIONS, explorerTx, type Net } from '../config';
import { ApiError, api, type ServerInfo } from '../lib/api';
import { blocksToText, hex, loadWallet, sats, short, unhex, usd } from '../lib/format';
import type { Wallet } from '../lib/wallet';

const HEX33 = /^0[23][0-9a-f]{64}$/i;

type Step = { state: 'idle' } | { state: 'busy'; msg: string } | { state: 'done'; txid: string; budget: bigint } | { state: 'error'; msg: string };

export function FundTab({ wallet, info, infoErr, net, demoAgentPub, onConnect, onOpened, onRunOnTab, openTabs }: {
  wallet: Wallet | null; info: ServerInfo | null; infoErr: string | null; net: Net; demoAgentPub: string;
  onConnect: () => void; onOpened: () => void; onRunOnTab?: (tab: string) => void; openTabs?: Set<string>;
}) {
  const budgets = BUDGETS[net];
  const [agentPub, setAgentPub] = useState(demoAgentPub);
  const [budget, setBudget] = useState(budgets[1]);
  const [duration, setDuration] = useState(DURATIONS[net === 'chipnet' ? 0 : 1].blocks);
  const [step, setStep] = useState<Step>({ state: 'idle' });
  const [balance, setBalance] = useState<bigint | null>(null);
  const [drip, setDrip] = useState<{ busy: boolean; msg?: string; ok?: boolean; until?: number }>({ busy: false });
  const price = BigInt(info?.routes[0]?.price ?? 1000);
  const spendable = budget - 546n;
  const calls = spendable > 0n ? spendable / price : 0n;
  const isDemo = !!demoAgentPub && agentPub.trim().toLowerCase() === demoAgentPub.toLowerCase();
  const bchUsd = info?.bchUsd;

  useEffect(() => { if (!agentPub && demoAgentPub) setAgentPub(demoAgentPub); }, [demoAgentPub]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setBudget(BUDGETS[net][1]); setStep({ state: 'idle' }); }, [net]);
  useEffect(() => {
    setBalance(null);
    if (!wallet) return;
    let live = true;
    const load = () => wallet.balance().then((b) => live && setBalance(b)).catch(() => {});
    load();
    const t = setInterval(load, 8_000);
    return () => { live = false; clearInterval(t); };
  }, [wallet, step.state, drip.ok]);

  const keyOk = HEX33.test(agentPub.trim());
  const FEE_ROOM = 600n;
  const funded = balance !== null && balance >= budget + FEE_ROOM;
  const minBudget = budgets[0];
  const needsDrip = balance !== null && balance < minBudget + FEE_ROOM;
  // "Use my balance": everything the wallet can put in, if that's a valid tab (provider minimum ~2.2k sats).
  const maxAffordable = balance !== null ? ((balance - FEE_ROOM) / 100n) * 100n : 0n;
  const showUseBalance = balance !== null && !funded && maxAffordable >= 2_200n && !budgets.includes(maxAffordable);
  const dripLocked = !!drip.until && Date.now() < drip.until;
  const blocker = !info ? (infoErr ? 'Provider API unreachable' : 'Waiting for the provider API…')
    : !keyOk ? 'Enter a 33-byte agent public key'
    : balance === null ? 'Checking your balance…'
    : !funded ? `Need ${sats(budget + FEE_ROOM - balance)} more sats${showUseBalance ? ' (or use your balance)' : ''}` : null;

  async function getTestCoins() {
    if (!wallet) return;
    setDrip({ busy: true });
    try { const r = await api.drip(wallet.address); setDrip({ busy: false, ok: true, msg: `Sent ${sats(r.sats)} test sats · ${short(r.txid, 6)}` }); }
    catch (e) {
      const retry = e instanceof ApiError ? Number(e.body.retryInMs ?? 0) : 0;
      setDrip({ busy: false, ok: false, msg: (e as Error).message, until: retry ? Date.now() + retry : undefined });
    }
  }

  async function open() {
    if (!wallet || !info) return;
    try {
      setStep({ state: 'busy', msg: wallet.kind === 'wizard' ? 'Approve the transaction in your wallet…' : 'Signing and broadcasting…' });
      const { chain } = await loadWallet();
      const timeout = (await chain(net).getBlockHeight()) + duration;
      const txid = await wallet.openTab({ agentPub: unhex(agentPub.trim()), providerPub: unhex(info.providerPub), timeout: BigInt(timeout), budget });
      setStep({ state: 'busy', msg: 'Registering the tab with the API provider…' });
      let lastErr: unknown;
      for (let i = 0; i < 6; i++) {
        try {
          await api.register({ txid, vout: 0, ownerPub: hex(wallet.ownerPub), agentPub: agentPub.trim().toLowerCase(), timeout });
          lastErr = null;
          break;
        } catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, 1500)); }
      }
      if (lastErr) throw lastErr;
      setStep({ state: 'done', txid, budget });
      onOpened();
    } catch (e) {
      setStep({ state: 'error', msg: (e as Error).message ?? String(e) });
    }
  }

  const choice = (on: boolean) => `rounded-lg border px-3 py-2.5 text-left transition ${on ? 'border-bch bg-bch/10' : 'border-line-2 hover:bg-white/[0.03]'}`;

  return (
    <section id="fund" className="scroll-mt-24 rounded-2xl border border-line bg-panel p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold">Fund your agent's tab</h2>
          <p className="mt-1 text-sm text-muted">You stay the owner. The agent can spend up to the budget but can never withdraw it. Unused sats come back to you.</p>
        </div>
        <span className={`shrink-0 rounded-full border px-2.5 py-1 font-mono text-[11px] ${net === 'mainnet' ? 'border-warn/50 text-warn' : 'border-line-2 text-muted'}`}>{net}</span>
      </div>

      <div className="mt-6 grid gap-5">
        <label className="grid gap-1.5">
          <span className="flex flex-wrap items-center justify-between gap-1 text-xs font-medium uppercase tracking-wider text-dim">
            Agent public key
            {isDemo && <span className="rounded bg-bch/15 px-1.5 py-0.5 font-mono text-[10px] normal-case tracking-normal text-bch-2">Demo agent (runs on this server)</span>}
          </span>
          <input value={agentPub} onChange={(e) => setAgentPub(e.target.value)} placeholder="02… / 03…"
            className="w-full min-w-0 rounded-lg border border-line-2 bg-ink px-3 py-2.5 font-mono text-[13px]" spellCheck={false} />
          <span className="text-xs leading-relaxed text-dim">
            Your own agent? Paste the <code className="text-muted">agentPub</code> from its MCP tool <code className="text-muted">agent_info</code>.
            {demoAgentPub && !isDemo && <> Or <button className="text-bch-2 hover:underline" onClick={() => setAgentPub(demoAgentPub)}>use the demo agent</button>.</>}
            {' '}This key can only sign vouchers. It can't move funds anywhere else.
          </span>
        </label>

        <div className="grid gap-1.5">
          <span className="text-xs font-medium uppercase tracking-wider text-dim">Budget</span>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {budgets.map((b) => (
              <button key={String(b)} onClick={() => setBudget(b)} className={choice(budget === b)}>
                <div className="font-mono text-sm font-semibold">{sats(b)} sats</div>
                <div className="text-[11px] text-dim">≈ {String((b - 546n) / price)} calls{bchUsd ? ` · ${usd(b, bchUsd)}` : ''}</div>
              </button>
            ))}
          </div>
          {(showUseBalance || (!budgets.includes(budget) && budget > 0n)) && (
            <button onClick={() => setBudget(maxAffordable)} className={`${choice(budget === maxAffordable)} flex items-center justify-between`}>
              <span><span className="font-mono text-sm font-semibold">Use my balance · {sats(maxAffordable)} sats</span>
                <span className="block text-[11px] text-dim">≈ {String((maxAffordable - 546n) / price)} calls, keeps ~600 sats for the fee</span></span>
            </button>
          )}
        </div>

        <div className="grid gap-1.5">
          <span className="text-xs font-medium uppercase tracking-wider text-dim">Refundable after</span>
          <div className={`grid grid-cols-1 gap-2 ${net === 'mainnet' ? 'sm:grid-cols-2' : 'sm:grid-cols-3'}`}>
            {DURATIONS.filter((d) => net !== 'mainnet' || d.blocks <= 144).map((d) => (
              <button key={d.blocks} onClick={() => setDuration(d.blocks)} className={choice(duration === d.blocks)}>
                <span className="text-sm">{d.label}</span> <span className="text-[11px] text-dim">· {d.blocks} blocks</span>
              </button>
            ))}
          </div>
        </div>

        <dl className="grid gap-2 rounded-xl border border-line bg-ink/60 p-4 text-sm">
          {[
            ['Agent can spend at most', `${sats(spendable)} sats · ${String(calls)} calls @ ${sats(price)}`],
            ['Kept back for the owner', '546 sats minimum (BCH dust limit for your refund output)'],
            ['Provider can settle', 'only the highest signed voucher'],
            ['If the provider vanishes', `full refund after ${duration} blocks (${blocksToText(duration)})`],
          ].map(([k, v]) => (
            <div key={k} className="flex flex-wrap justify-between gap-x-4 gap-y-0.5">
              <dt className="text-muted">{k}</dt><dd className="font-mono text-[13px]">{v}</dd>
            </div>
          ))}
          <div className="mt-1 flex flex-wrap justify-between gap-x-4 gap-y-0.5 border-t border-line pt-2 text-xs text-dim">
            <span>Provider key <span className="font-mono text-muted">{info ? short(info.providerPub, 6) : '…'}</span></span>
            <a className="tap text-bch-2 hover:underline" href={CONTRACT_SOURCE_URL || api.contractUrl()} target="_blank" rel="noreferrer">Read the covenant (AgentTab.cash) ↗</a>
          </div>
        </dl>

        {!wallet ? (
          <button onClick={onConnect} className="rounded-xl bg-bch px-5 py-3 font-semibold text-ink hover:bg-bch-2">Connect a wallet to fund</button>
        ) : (
          <div className="grid gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-dim">
              <span>Paying from {wallet.label} · <span className="font-mono">{short(wallet.address.split(':')[1] ?? wallet.address, 6)}</span></span>
              <span className="font-mono">{balance === null ? '…' : `${sats(balance)} sats available`}</span>
            </div>
            {wallet.kind === 'burner' && needsDrip && (
              <div className="rounded-lg border border-bch/30 bg-bch/[0.07] p-3 text-sm">
                <p className="text-muted">{balance === 0n ? 'This test wallet is empty.' : `This test wallet has ${sats(balance!)} sats, not enough for a tab.`} Free chipnet coins, no signup:</p>
                {info?.features?.faucet ? (
                  <button onClick={getTestCoins} disabled={drip.busy || drip.ok || dripLocked}
                    className="mt-2 min-h-[44px] w-full rounded-lg bg-bch/90 px-4 py-2.5 font-semibold text-ink hover:bg-bch-2 disabled:opacity-60">
                    {drip.busy ? 'Sending test coins…' : drip.ok ? 'Test coins on the way' : dripLocked ? `Try again in ${Math.ceil((drip.until! - Date.now()) / 60_000)} min` : `Get ${sats(info.features.faucet.dripSats)} free test sats`}
                  </button>
                ) : (
                  <a className="mt-1 inline-block text-bch-2 underline" href="https://chipnet.bch.ninja" target="_blank" rel="noreferrer">Open a chipnet faucet ↗</a>
                )}
                {drip.msg && <p className={`mt-1.5 text-xs ${drip.ok ? 'text-bch-2' : 'text-warn'}`}>{drip.msg}</p>}
                <button className="mt-2 block w-full break-all rounded bg-ink/60 px-2 py-1.5 text-left font-mono text-[11px] text-dim" title="Copy address"
                  onClick={() => navigator.clipboard?.writeText(wallet.address)}>{wallet.address}</button>
              </div>
            )}
            <button disabled={!!blocker || step.state === 'busy'} onClick={open}
              className="rounded-xl bg-bch px-5 py-3 font-semibold text-ink transition hover:bg-bch-2 disabled:cursor-not-allowed disabled:opacity-40">
              {step.state === 'busy' ? step.msg : `Open tab with ${sats(budget)} sats${net === 'mainnet' && bchUsd ? ` (${usd(budget, bchUsd)})` : ''}`}
            </button>
            {blocker && step.state !== 'busy' && <p className="text-center text-xs text-dim">{blocker}</p>}
          </div>
        )}
        {step.state === 'done' && (!openTabs || openTabs.has(`${step.txid}:0`)) && (
          <p className="slide-in rounded-lg border border-bch/30 bg-bch/10 px-3 py-2.5 text-sm">
            Tab open with {sats(step.budget)} sats. {isDemo ? 'The demo agent can now pay from it.' : 'Your agent can start paying now.'}{' '}
            <a className="tap font-mono text-bch-2 hover:underline" href={explorerTx(net, step.txid)} target="_blank" rel="noreferrer">{short(step.txid, 8)} ↗</a>
            {isDemo && onRunOnTab && (
              <button onClick={() => onRunOnTab(`${step.txid}:0`)} className="mt-2 block min-h-[44px] w-full rounded-lg bg-bch px-4 py-2 font-semibold text-ink hover:bg-bch-2">▶ Run agent on this tab</button>
            )}
          </p>
        )}
        {step.state === 'error' && <p className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2.5 text-sm text-bad">{step.msg}</p>}
      </div>
    </section>
  );
}
