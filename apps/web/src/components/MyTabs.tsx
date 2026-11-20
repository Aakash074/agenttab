import { useCallback, useEffect, useState } from 'react';
import { explorerAddr, explorerTx, type Net } from '../config';
import { api, type ServerInfo, type TabRecord } from '../lib/api';
import { blocksToText, hex, loadWallet, sats, short, unhex } from '../lib/format';
import { localTabs, type LocalTab } from '../lib/localTabs';
import type { Wallet } from '../lib/wallet';

const STATUS: Record<TabRecord['status'], string> = {
  open: 'text-bch-2 bg-bch/10', settled: 'text-gold bg-gold/10', cancelled: 'text-info bg-info/10', expired: 'text-muted bg-subtle', closed: 'text-muted bg-subtle',
};

function TabCard({ t, tip, net, wallet, info, demoAgentPub, onChange, onRunOnTab, running }: {
  t: TabRecord; tip: number; net: Net; wallet: Wallet; info: ServerInfo; demoAgentPub: string; onChange: () => void;
  onRunOnTab?: (tab: string) => void; running?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; txid?: string } | null>(null);
  const budget = BigInt(t.budget);
  const spent = BigInt(t.settledAmount ?? t.highest?.amount ?? '0');
  const returned = t.status === 'cancelled' ? budget - BigInt(t.settleTxBytes ?? 0) : budget - spent;
  const cap = budget - 546n;
  const pct = cap > 0n ? Number((spent * 1000n) / cap) / 10 : 0;
  const left = t.timeout - tip;
  const refundable = left <= 0 && t.status !== 'settled' && t.status !== 'closed';
  const isDemo = !!demoAgentPub && t.agentPub === demoAgentPub.toLowerCase();
  const canClose = t.status === 'open';

  async function closeNow() {
    setBusy(true); setMsg(null);
    try {
      const r = await api.closeTab(t.id);
      setMsg({ ok: true, text: r.action === 'cancel'
        ? `Returned to you: ${sats(r.returnedSats)} sats (too little was spent to settle, so the provider waived it).`
        : `Returned to you: ${sats(r.returnedSats)} sats (provider took ${sats(r.settledSats)}).`, txid: r.txid });
      onChange();
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    setBusy(false);
  }

  async function refund() {
    setBusy(true); setMsg(null);
    try {
      const txid = await wallet.refund({ agentPub: unhex(t.agentPub), providerPub: unhex(info.providerPub), timeout: BigInt(t.timeout), txid: t.outpoint.txid, vout: t.outpoint.vout });
      setMsg({ ok: true, text: 'Refunded to your wallet.', txid });
      onChange();
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    setBusy(false);
  }

  return (
    <li className="rounded-xl border border-line bg-ink/50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${STATUS[t.status]}`}>{t.status === 'cancelled' ? 'waived' : t.status}</span>
          <a className="tap font-mono text-xs text-muted hover:text-bch-2" href={explorerTx(net, t.outpoint.txid)} target="_blank" rel="noreferrer">opened in {short(t.outpoint.txid, 6)} ↗</a>
        </div>
        <span className="font-mono text-xs text-dim">agent {short(t.agentPub, 4)}{demoAgentPub && t.agentPub === demoAgentPub.toLowerCase() ? ' (demo)' : ''}</span>
      </div>
      <div className="mt-1 font-mono text-[11px] text-dim">
        covenant <a className="tap hover:text-bch-2" href={explorerAddr(net, t.contractAddress)} target="_blank" rel="noreferrer">{short(t.contractAddress.split(':')[1] ?? t.contractAddress, 8)} ↗</a>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-subtle">
        <div className="h-full rounded-full bg-bch transition-all" style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-y-1.5 text-sm sm:grid-cols-4">
        <div><dt className="text-[11px] text-dim">Budget</dt><dd className="font-mono">{sats(budget)}</dd></div>
        <div><dt className="text-[11px] text-dim">Spent ({t.requests} call{t.requests === 1 ? '' : 's'})</dt><dd className="font-mono">{sats(spent)}</dd></div>
        <div><dt className="text-[11px] text-dim">{t.status === 'settled' || t.status === 'cancelled' ? 'Returned to you' : 'Remaining'}</dt><dd className="font-mono">{sats(returned)}</dd></div>
        <div><dt className="text-[11px] text-dim">Refund unlock</dt><dd className="whitespace-nowrap font-mono">{t.status !== 'open' && t.status !== 'expired' ? 'closed' : left > 0 ? `in ${blocksToText(left)}` : 'unlocked'}</dd></div>
      </dl>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {t.settledTxid && (
          <a className="text-xs text-muted hover:text-bch-2" href={explorerTx(net, t.settledTxid)} target="_blank" rel="noreferrer">
            {t.status === 'cancelled'
              ? <>{t.requests} call{t.requests === 1 ? '' : 's'}, waived (too small to settle). {sats(returned)} sats came back to you (budget minus the {sats(budget - returned)}-sat miner fee) · </>
              : <>Status: settled. Provider took {sats(t.settledAmount)} sats, {sats(budget - spent)} returned to you · </>}
            <span className="font-mono">{short(t.settledTxid, 6)} ↗</span>
          </a>
        )}
        {t.status === 'open' && (
          <div className="ml-auto flex w-full flex-wrap gap-2 sm:w-auto">
            {isDemo && onRunOnTab && (
              <button onClick={() => onRunOnTab(t.id)} disabled={running || busy}
                className="btn-primary min-h-[44px] flex-1 rounded-lg bg-bch px-3 text-sm font-semibold text-on-bch hover:bg-bch-hover disabled:opacity-60 sm:min-h-0 sm:flex-none sm:py-1.5">
                {running ? 'Busy…' : 'Run 3 calls on this tab'}
              </button>
            )}
            <button onClick={closeNow} disabled={!canClose || busy}
              className="min-h-[44px] flex-1 rounded-lg border border-line-2 px-3 text-sm font-medium transition hover:border-bch/60 disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-0 sm:flex-none sm:py-1.5"
              title={canClose ? 'Settle now: provider gets what was signed, the rest comes back to you' : 'Needs at least ~1,046 sats of vouchers to settle on-chain; otherwise refund after the timeout'}>
              {busy ? 'Closing…' : spent >= 1_246n ? 'Close tab now' : 'Close tab now (full refund)'}
            </button>
          </div>
        )}
        {t.status === 'expired' && (
          <button onClick={refund} disabled={!refundable || busy}
            className="min-h-[44px] rounded-lg border border-line-2 px-3 text-sm font-medium transition hover:border-bch/60 disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-0 sm:py-1.5"
            title={refundable ? 'Reclaim everything in this tab' : 'Available after the timeout; the provider can settle until then'}>
            {busy ? 'Refunding…' : refundable ? 'Refund' : `Refund unlocks in ${blocksToText(left)}`}
          </button>
        )}
      </div>
      {msg && !(msg.ok && t.status !== 'open') && (
        <p className={`mt-2 text-sm ${msg.ok ? 'text-bch-2' : 'text-bad'}`}>
          {msg.text} {msg.txid && <a className="font-mono underline" href={explorerTx(net, msg.txid)} target="_blank" rel="noreferrer">{short(msg.txid, 8)}</a>}
        </p>
      )}
    </li>
  );
}

/** A tab this browser opened that the server does not list (down, or forgot it after a restart): the owner's timeout refund. */
function LocalTabCard({ t, tip, net, wallet, onChange }: { t: LocalTab; tip: number; net: Net; wallet: Wallet; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; txid?: string } | null>(null);
  const left = tip ? t.timeout - tip : Infinity;
  const refundable = left <= 0;
  async function refund() {
    setBusy(true); setMsg(null);
    try {
      const txid = await wallet.refund({ agentPub: unhex(t.agentPub), providerPub: unhex(t.providerPub), timeout: BigInt(t.timeout), txid: t.txid, vout: t.vout });
      setMsg({ ok: true, text: 'Refunded to your wallet.', txid });
      onChange();
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    setBusy(false);
  }
  return (
    <li className="rounded-xl border border-line bg-ink/50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="rounded bg-bch/10 px-1.5 py-0.5 text-xs font-semibold text-bch-2">locked</span>
          <a className="tap font-mono text-xs text-muted hover:text-bch-2" href={explorerTx(net, t.txid)} target="_blank" rel="noreferrer">opened in {short(t.txid, 6)} ↗</a>
        </div>
        <span className="font-mono text-xs text-dim">{sats(t.budget)} sats</span>
      </div>
      <p className="mt-2 text-sm text-muted">The server does not list this tab right now. Your coins stay in the covenant; after the timeout only you can take them back.</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button onClick={refund} disabled={!refundable || busy}
          className="min-h-[44px] rounded-lg border border-line-2 px-3 text-sm font-medium transition hover:border-bch/60 disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-0 sm:py-1.5"
          title={refundable ? 'Reclaim everything in this tab' : 'Available after the timeout'}>
          {busy ? 'Refunding…' : refundable ? 'Refund' : tip ? `Refund unlocks in ${blocksToText(left)}` : 'Refund after the timeout'}
        </button>
      </div>
      {msg && (
        <p className={`mt-2 text-sm ${msg.ok ? 'text-bch-2' : 'text-bad'}`}>
          {msg.text} {msg.txid && <a className="font-mono underline" href={explorerTx(net, msg.txid)} target="_blank" rel="noreferrer">{short(msg.txid, 8)}</a>}
        </p>
      )}
    </li>
  );
}

export function MyTabs({ wallet, info, net, refreshKey, demoAgentPub, onTabs, onRunOnTab, running, onConnect, onTryDemo }: {
  wallet: Wallet | null; info: ServerInfo | null; net: Net; refreshKey: number; demoAgentPub: string; onTabs?: (tabs: TabRecord[]) => void;
  onRunOnTab?: (tab: string) => void; running?: boolean;
  /** Empty state actions: connect a wallet, or go run the free demo. */
  onConnect?: () => void; onTryDemo?: () => void;
}) {
  const [tabs, setTabs] = useState<TabRecord[]>([]);
  const [tip, setTip] = useState(0);
  const [stale, setStale] = useState<LocalTab[]>([]);
  const [lockTip, setLockTip] = useState(0);
  const load = useCallback(() => {
    if (!wallet) return;
    const owner = hex(wallet.ownerPub);
    api.tabsByOwner(owner).then((r) => { setTabs(r.tabs); setTip(r.tip); onTabs?.(r.tabs); return new Set(r.tabs.map((t) => t.id)); })
      .catch(() => null)
      .then(async (known) => {
        // Tabs this browser opened that the server does not list: show them while their coin is still locked.
        const mine = localTabs(net, owner).filter((t) => !known?.has(`${t.txid}:${t.vout}`));
        if (!mine.length) { setStale([]); return; }
        const w = await loadWallet();
        const locked = await Promise.all(mine.map((t) => w.tabStillLocked(net, {
          ownerPub: wallet.ownerPub, agentPub: unhex(t.agentPub), providerPub: unhex(t.providerPub), timeout: BigInt(t.timeout), txid: t.txid, vout: t.vout,
        }).catch(() => false)));
        setStale(mine.filter((_, i) => locked[i]));
        setLockTip(await w.lockTipOf(net).catch(() => 0));
      }).catch(() => {});
  }, [wallet, net]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setTabs([]); setStale([]); load(); const t = setInterval(load, 10_000); return () => clearInterval(t); }, [load, refreshKey]);
  const orphans = stale.filter((s) => !tabs.some((t) => t.id === `${s.txid}:${s.vout}`));

  return (
    <section id="tabs" className="flex scroll-mt-24 flex-col card rounded-2xl border border-line bg-panel p-5 sm:p-6">
      <h3 className="text-lg font-semibold">Your tabs</h3>
      {!wallet || tabs.length + orphans.length === 0 ? (
        <div className="empty-box mt-4 flex flex-1 flex-col items-center justify-center gap-3 rounded-xl px-5 py-8 text-center">
          <svg aria-hidden width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="text-bch-2"><path d="M6 3.5h12v17l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3-2 1.3z" /><path d="M9 8.5h6M9 12h6M9 15.5h3" /></svg>
          <p className="max-w-xs text-sm text-muted">{!wallet ? 'Connect a wallet to see the tabs you funded, with spend, change and a close button for each.' : `No tabs yet for this wallet on ${net === 'mainnet' ? 'Mainnet' : 'Chipnet'}.`}</p>
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
            {!wallet && onConnect && <button type="button" onClick={onConnect} className="control px-4">Connect a wallet</button>}
            {onTryDemo && <button type="button" onClick={onTryDemo} className="tap text-sm font-medium text-bch-2 hover:underline">Try the free 5¢ demo →</button>}
          </div>
        </div>
      ) : (
        <ul className="mt-4 grid gap-3">
          {orphans.map((t) => <LocalTabCard key={`${t.txid}:${t.vout}`} t={t} tip={lockTip} net={net} wallet={wallet} onChange={load} />)}
          {tabs.map((t) => <TabCard key={t.id} t={t} tip={tip} net={net} wallet={wallet} info={info!} demoAgentPub={demoAgentPub} onChange={load} onRunOnTab={onRunOnTab} running={running} />)}
        </ul>
      )}
    </section>
  );
}
