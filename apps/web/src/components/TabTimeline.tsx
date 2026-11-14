import type { FeedEvent } from '../lib/api';
import { sats, short } from '../lib/format';
import { explorerTx, type Net } from '../config';

/** One real tab's life (the visitor's own if they ran the journey, else the latest closed non-attack tab):
 *  on-chain open → off-chain vouchers → on-chain settle, with the actual amounts and tx links. */
export function TabTimeline({ events, net, focusTab }: { events: FeedEvent[]; net: Net; focusTab?: string }) {
  const calls = (tab: string) => events.filter((p) => p.type === 'pay' && p.tab === tab).length;
  const candidates = events.filter((e) => (e.type === 'settle' || e.type === 'cancel') && e.tag !== 'attack' && calls(e.tab) > 0);
  // Prefer a settled tab with a few calls: it shows the whole story (vouchers → provider/owner split).
  const closed = candidates.find((e) => e.type === 'settle' && calls(e.tab) >= 2) ?? candidates[0];
  const tab = focusTab ?? closed?.tab;
  if (!tab) return null;
  const open = events.find((e) => e.type === 'open' && e.tab === tab);
  const pays = events.filter((e) => e.type === 'pay' && e.tab === tab).sort((a, b) => a.id - b.id);
  const close = events.find((e) => (e.type === 'settle' || e.type === 'cancel') && e.tab === tab);
  const budget = open?.amount ? BigInt(open.amount) : undefined;
  const settled = close?.type === 'settle' ? BigInt(close.amount ?? 0) : 0n;
  const link = (txid?: string) => txid
    ? <a className="tap font-mono text-xs text-bch-2 hover:underline" href={explorerTx(net, txid)} target="_blank" rel="noreferrer">{short(txid, 6)} ↗</a>
    : <span className="font-mono text-xs text-dim">pending</span>;
  const nodes = [
    { k: 'tx 1 · open', title: budget ? `${sats(budget)} sats locked in the covenant` : 'Budget locked in the covenant', tx: link(open?.txid), onchain: true },
    { k: `off-chain · ${pays.length} voucher${pays.length === 1 ? '' : 's'}`, title: pays.length ? `${pays.map((p) => sats(p.amount)).join(' → ')} sats` : 'No calls yet', tx: <span className="font-mono text-xs text-dim">0 transactions · 0 fees</span>, onchain: false },
    { k: `tx 2 · ${close?.type === 'cancel' ? 'waive' : 'settle'}`,
      title: close ? (close.type === 'settle' && budget ? `provider ${sats(settled)} · owner ${sats(budget - settled)}` : 'everything back to the owner') : 'when the tab closes',
      tx: link(close?.txid), onchain: true },
  ];
  return (
    <div id="how" className="scroll-mt-24 mt-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">{focusTab ? 'Your tab, start to finish' : 'One real tab, start to finish'}</h2>
        <span className="font-mono text-[11px] text-dim">TAB #{tab.slice(0, 4).toUpperCase()}</span>
      </div>
      <ol className="relative mt-3 grid gap-3">
        <div aria-hidden className="absolute bottom-2 left-[9px] top-2 w-px bg-line-2" />
        {nodes.map((n) => (
          <li key={n.k} className="relative grid grid-cols-[1fr_auto] items-baseline gap-x-3 pl-7">
            <span className={`absolute left-0 top-1 h-[19px] w-[19px] rounded-full border-2 ${n.onchain ? 'border-bch bg-bch' : 'border-line-2 bg-panel'}`} />
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
