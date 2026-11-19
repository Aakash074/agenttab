import type { Stats } from '../lib/api';
import { api } from '../lib/api';
import { plural, ratio, sats, usd } from '../lib/format';
import { CONTRACT_SOURCE_URL } from '../config';

const STEPS = [
  { n: 'Open', tx: '1 transaction', body: 'You lock a few cents in a covenant for one agent.' },
  { n: 'Pay per call', tx: '0 transactions', body: 'For each API call the agent signs a voucher. Instant, no fee.' },
  { n: 'Close', tx: '1 transaction', body: 'The provider claims the last voucher. The rest must come back to you.' },
];

function FeeBox({ stats, bchUsd }: { stats: Stats; bchUsd?: number }) {
  const fee = stats.feeSats ?? 0, txs = stats.onchainTxs ?? 0;
  const perCallTxs = stats.perCallTxs ?? stats.paidCalls, perCallFee = stats.perCallFeeSats ?? 0;
  const money = (v: number) => (bchUsd ? usd(BigInt(Math.round(v)), bchUsd) : `${sats(Math.round(v))} sats`);
  if (fee < perCallFee) {
    return (
      <p className="text-sm text-muted">
        Paying on-chain per call would have taken <b className="text-fg">{plural(perCallTxs, 'transaction')}</b> and {money(perCallFee)} in fees.
        AgentTab used {plural(txs, 'transaction')}: <b className="text-bch-2">{ratio(perCallTxs, txs)} fewer</b>.
      </p>
    );
  }
  const perTab = txs > 0 ? (2 * fee) / txs : 770;
  const perCall = perCallTxs > 0 ? perCallFee / perCallTxs : 226;
  const breakEven = Math.floor(perTab / perCall) + 1;
  return (
    <p className="text-sm text-muted">
      <b className="text-fg">Cheaper than paying per call from {breakEven}+ calls.</b> A tab costs about {money(perTab)} in miner fees however many calls it covers;
      paying on-chain costs about {money(perCall)} per call.
    </p>
  );
}

export function HowItWorks({ stats, bchUsd, direct, advanced, advancedOpen, onAdvancedToggle }: {
  stats: Stats | null; bchUsd?: number;
  /** The 1¢ no-tab card (shown here when it isn't the hero action). */
  direct?: React.ReactNode;
  advanced: React.ReactNode; advancedOpen: boolean; onAdvancedToggle: (open: boolean) => void;
}) {
  return (
    <div id="how" className="grid scroll-mt-24 gap-5">
      <ol className="grid gap-3 sm:grid-cols-3">
        {STEPS.map((s, i) => (
          <li key={s.n} className="relative rounded-2xl border border-line bg-panel p-4 card">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-semibold">{i + 1}. {s.n}</span>
              <span className={`font-mono text-xs ${i === 1 ? 'text-bch-2' : 'text-dim'}`}>{s.tx}</span>
            </div>
            <p className="mt-1.5 text-sm text-muted">{s.body}</p>
          </li>
        ))}
      </ol>
      <div className="grid gap-3 rounded-2xl border border-line bg-panel p-5 card">
        <h3 className="font-semibold">Who can take what</h3>
        <p className="text-sm text-muted">
          A Bitcoin Cash covenant holds the money. The provider can claim only the highest voucher the agent signed, and the transaction must send
          the rest back to the owner. The agent can never withdraw. If the provider vanishes, the owner takes everything back after the timeout.
        </p>
        {stats && stats.paidCalls > 0 && stats.feeSats !== undefined && stats.perCallFeeSats !== undefined && <FeeBox stats={stats} bchUsd={bchUsd} />}
        <a className="tap text-sm font-medium text-bch-2 hover:underline" href={CONTRACT_SOURCE_URL || api.contractUrl()} target="_blank" rel="noreferrer">Read the covenant (AgentTab.cash) ↗</a>
      </div>
      {direct}
      <details id="advanced" open={advancedOpen} onToggle={(e) => onAdvancedToggle((e.target as HTMLDetailsElement).open)}
        className="group rounded-2xl border border-line bg-panel card">
        <summary className="flex min-h-[52px] cursor-pointer list-none items-center justify-between gap-3 px-5 font-semibold">
          <span>Advanced: fund a tab for your own agent</span>
          <span aria-hidden className="text-dim transition-transform group-open:rotate-180">▾</span>
        </summary>
        <div className="border-t border-line">{advanced}</div>
      </details>
    </div>
  );
}
