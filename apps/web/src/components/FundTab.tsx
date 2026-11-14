import { useEffect, useState } from 'react';
import { DEMO_AGENT_PUB, DURATIONS, explorerTx, type Net } from '../config';
import { api, type ServerInfo } from '../lib/api';
import { blocksToText, sats, short } from '../lib/format';
import { hex, unhex, type Wallet } from '../lib/wallet';

const BUDGETS = [5_000n, 20_000n, 100_000n];
const HEX33 = /^0[23][0-9a-f]{64}$/i;

type Step = { state: 'idle' } | { state: 'busy'; msg: string } | { state: 'done'; txid: string; budget: bigint } | { state: 'error'; msg: string };

export function FundTab({ wallet, info, net, onConnect, onOpened }: {
  wallet: Wallet | null; info: ServerInfo | null; net: Net; onConnect: () => void; onOpened: () => void;
}) {
  const [agentPub, setAgentPub] = useState(DEMO_AGENT_PUB);
  const [budget, setBudget] = useState(20_000n);
  const [duration, setDuration] = useState(DURATIONS[1].blocks);
  const [step, setStep] = useState<Step>({ state: 'idle' });
  const [balance, setBalance] = useState<bigint | null>(null);
  const price = BigInt(info?.routes[0]?.price ?? 1000);
  const calls = budget > 546n ? (budget - 546n) / price : 0n;

  useEffect(() => {
    setBalance(null);
    if (!wallet) return;
    let live = true;
    const load = () => wallet.balance().then((b) => live && setBalance(b)).catch(() => {});
    load();
    const t = setInterval(load, 15_000);
    return () => { live = false; clearInterval(t); };
  }, [wallet, step.state]);

  const valid = HEX33.test(agentPub.trim()) && budget >= 2_000n && !!info;
  async function open() {
    if (!wallet || !info) return;
    try {
      setStep({ state: 'busy', msg: wallet.kind === 'wizard' ? 'Approve the transaction in your wallet…' : 'Signing and broadcasting…' });
      const tip = await import('../lib/wallet').then((m) => m.chain(net).getBlockHeight());
      const timeout = tip + duration;
      const txid = await wallet.openTab({ agentPub: unhex(agentPub.trim()), providerPub: unhex(info.providerPub), timeout: BigInt(timeout), budget });
      setStep({ state: 'busy', msg: 'Registering the tab with the API provider…' });
      // Electrum may need a moment to index the new utxo.
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

  return (
    <section id="fund" className="rounded-2xl border border-line bg-panel p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold">Fund your agent's tab</h2>
          <p className="mt-1 text-sm text-muted">You stay the owner. The agent can spend up to the budget, never withdraw. Unused sats come back to you.</p>
        </div>
        <span className="rounded-full border border-line-2 px-2.5 py-1 font-mono text-[11px] text-muted">{net}</span>
      </div>

      <div className="mt-6 grid gap-5">
        <label className="grid gap-1.5">
          <span className="text-xs font-medium uppercase tracking-wider text-dim">Agent public key</span>
          <input value={agentPub} onChange={(e) => setAgentPub(e.target.value)} placeholder="02… / 03… (from the agent's MCP tool `agent_info`)"
            className="rounded-lg border border-line-2 bg-ink px-3 py-2.5 font-mono text-[13px]" spellCheck={false} />
          <span className="text-xs text-dim">
            {DEMO_AGENT_PUB && agentPub !== DEMO_AGENT_PUB
              ? <button className="text-bch-2 hover:underline" onClick={() => setAgentPub(DEMO_AGENT_PUB)}>Use the demo agent</button>
              : 'Signs vouchers only. It can never move the funds anywhere except to the provider, and only up to what it signed.'}
          </span>
        </label>

        <div className="grid gap-1.5">
          <span className="text-xs font-medium uppercase tracking-wider text-dim">Budget</span>
          <div className="grid grid-cols-3 gap-2">
            {BUDGETS.map((b) => (
              <button key={String(b)} onClick={() => setBudget(b)}
                className={`rounded-lg border px-3 py-2.5 text-left transition ${budget === b ? 'border-bch bg-bch/10' : 'border-line-2 hover:border-line-2/80 hover:bg-white/[0.02]'}`}>
                <div className="font-mono text-sm font-semibold">{sats(b)} sats</div>
                <div className="text-[11px] text-dim">≈ {String((b - 546n) / price)} calls</div>
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-1.5">
          <span className="text-xs font-medium uppercase tracking-wider text-dim">Refundable after</span>
          <div className="grid grid-cols-3 gap-2">
            {DURATIONS.map((d) => (
              <button key={d.blocks} onClick={() => setDuration(d.blocks)}
                className={`rounded-lg border px-3 py-2 text-sm transition ${duration === d.blocks ? 'border-bch bg-bch/10' : 'border-line-2 hover:bg-white/[0.02]'}`}>
                {d.label} <span className="text-[11px] text-dim">· {d.blocks} blocks</span>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-line bg-ink/60 p-4 text-sm">
          <div className="flex justify-between"><span className="text-muted">Agent can spend at most</span><span className="font-mono">{sats(budget - 546n)} sats · {String(calls)} calls @ {sats(price)}</span></div>
          <div className="mt-1.5 flex justify-between"><span className="text-muted">Provider can settle</span><span className="font-mono">only the highest signed voucher</span></div>
          <div className="mt-1.5 flex justify-between"><span className="text-muted">If provider vanishes</span><span className="font-mono">full refund in {blocksToText(duration)}</span></div>
        </div>

        {!wallet ? (
          <button onClick={onConnect} className="rounded-xl bg-bch px-5 py-3 font-semibold text-ink hover:bg-bch-2">Connect a wallet to fund</button>
        ) : (
          <div className="grid gap-2">
            <div className="flex items-center justify-between text-xs text-dim">
              <span>Paying from {wallet.label} · <span className="font-mono">{short(wallet.address.split(':')[1] ?? wallet.address, 6)}</span></span>
              <span className="font-mono">{balance === null ? '…' : `${sats(balance)} sats available`}</span>
            </div>
            <button disabled={!valid || step.state === 'busy'} onClick={open}
              className="rounded-xl bg-bch px-5 py-3 font-semibold text-ink transition hover:bg-bch-2 disabled:cursor-not-allowed disabled:opacity-40">
              {step.state === 'busy' ? step.msg : `Open tab with ${sats(budget)} sats`}
            </button>
          </div>
        )}
        {step.state === 'done' && (
          <p className="slide-in rounded-lg border border-bch/30 bg-bch/10 px-3 py-2.5 text-sm">
            Tab open with {sats(step.budget)} sats. Your agent can start paying now.{' '}
            <a className="font-mono text-bch-2 hover:underline" href={explorerTx(net, step.txid)} target="_blank" rel="noreferrer">{short(step.txid, 8)}</a>
          </p>
        )}
        {step.state === 'error' && <p className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2.5 text-sm text-bad">{step.msg}</p>}
      </div>
    </section>
  );
}
