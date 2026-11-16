import type { FeedEvent } from '../lib/api';
import { sats, short } from '../lib/format';
import { explorerTx, type Net } from '../config';

/** One real tab's life (the same tab as the receipt above it): on-chain open → off-chain vouchers →
 *  on-chain settle, with the actual amounts and tx links. On-chain dots stay hollow until the tx exists. */
export function TabTimeline({ events, net, tab, mine, minCalls = 0 }: { events: FeedEvent[]; net: Net; tab?: string; mine?: boolean; minCalls?: number }) {
  if (!tab) return null;
  const open = events.find((e) => e.type === 'open' && e.tab === tab);
  const pays = events.filter((e) => e.type === 'pay' && e.tab === tab).sort((a, b) => a.id - b.id);
  const close = events.find((e) => (e.type === 'settle' || e.type === 'cancel') && e.tab === tab);
  // After a server restart the per-call log is gone; the settle tx still proves how much was paid.
  const derived = !pays.length && close?.type === 'settle' ? close.calls ?? 0 : 0;
  const count = Math.max(pays.length, minCalls, derived);
  const budget = open?.amount ? BigInt(open.amount) : undefined;
  const settled = close?.type === 'settle' ? BigInt(close.amount ?? 0) : 0n;
  const link = (txid?: string) => txid
    ? <a className="tap font-mono text-xs text-bch-2 hover:underline" href={explorerTx(net, txid)} target="_blank" rel="noreferrer">{short(txid, 6)} ↗</a>
    : <span className="font-mono text-xs text-dim">pending</span>;
  // Long demo tabs: show the first and the latest vouchers only.
  const amounts = pays.map((p) => sats(p.amount));
  const voucherText = amounts.length > 4 ? `${amounts[0]} → … → ${amounts.slice(-2).join(' → ')}` : amounts.join(' → ');
  const nodes = [
    { k: 'tx 1 · open', title: budget ? `${sats(budget)} sats locked in the covenant` : 'Budget locked in the covenant', tx: link(open?.txid), onchain: true, done: !!open?.txid },
    { k: `off-chain · ${count} voucher${count === 1 ? '' : 's'}`, title: pays.length ? `${voucherText} sats` : derived ? `${derived} call${derived === 1 ? '' : 's'} (from the settle tx; per-call log not kept after restart)` : close ? 'Per-call log not kept after restart' : 'No calls yet', tx: <span className="font-mono text-xs text-dim">0 transactions · 0 fees</span>, onchain: false, done: false },
    { k: `tx 2 · ${close?.type === 'cancel' ? 'waive' : 'settle'}`,
      title: close ? (close.type === 'settle' && budget ? `provider ${sats(settled)} · ${mine ? 'you' : 'owner'} ${sats(budget - settled)}` : (mine ? 'everything back to you' : 'everything back to the owner')) : 'when the tab closes',
      tx: link(close?.txid), onchain: true, done: !!close?.txid },
  ];
  return (
    <div id="how" className="scroll-mt-24 mt-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">{mine ? 'Your tab, start to finish' : 'This tab, start to finish'}</h2>
        <span className="font-mono text-[11px] text-dim">TAB #{tab.slice(0, 4).toUpperCase()}</span>
      </div>
      <ol className="relative mt-3 grid gap-3">
        <div aria-hidden className="absolute bottom-2 left-[9px] top-2 w-px bg-line-2" />
        {nodes.map((n) => (
          <li key={n.k} className="relative grid grid-cols-[1fr_auto] items-baseline gap-x-3 pl-7">
            <span className={`absolute left-0 top-1 h-[19px] w-[19px] rounded-full border-2 ${n.onchain ? (n.done ? 'border-bch bg-bch' : 'border-bch bg-panel') : 'border-line-2 bg-panel'}`}
              title={n.onchain ? (n.done ? 'On chain' : 'Not on chain yet') : 'Off chain'} />
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-dim">{n.k}</div>
              <div className="truncate text-sm font-medium">{n.title}</div>
            </div>
            <div>{n.tx}</div>
          </li>
        ))}
      </ol>
    </div>
  );
}
