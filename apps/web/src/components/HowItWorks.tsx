import { useEffect, useState } from 'react';
import type { FeedEvent, ServerInfo, TabRecord } from '../lib/api';
import { api } from '../lib/api';
import { plural, sats, short } from '../lib/format';
import { CONTRACT_SOURCE_URL, SERVERS, VERIFIED_SETTLES, explorerTx, type Net } from '../config';

const I = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
const STEPS = [
  { n: 'Open', tx: '1 tx', zero: false, body: 'You lock a few cents in a covenant for one agent.',
    icon: <svg width="18" height="18" viewBox="0 0 24 24" {...I}><rect x="4.5" y="10.5" width="15" height="10" rx="2.5" /><path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7M12 14.5v2.2" /></svg> },
  { n: 'Pay per call', tx: '0 tx', zero: true, body: 'For each API call the agent signs a voucher. Instant, no fee.',
    icon: <svg width="18" height="18" viewBox="0 0 24 24" {...I}><path d="M6 3.5h12v17l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3-2 1.3z" /><path d="M9 8.5h6M9 12h6M9 15.5h3" /></svg> },
  { n: 'Close', tx: '1 tx', zero: false, body: 'The provider claims the last voucher. The rest must come back to you.',
    icon: <svg width="18" height="18" viewBox="0 0 24 24" {...I}><path d="M4 12a8 8 0 1 0 2.3-5.6M4 4.5v3.9h3.9" /><path d="m9 12.2 2.1 2.1 4-4.3" /></svg> },
];

type Example = { tab: TabRecord; net: Net; hostedAgent: boolean };
const isExample = (t: TabRecord | null): t is TabRecord => !!t && t.status === 'settled' && !!t.settledTxid && t.requests >= 10;
const getJson = <T,>(url: string) => fetch(url, { signal: AbortSignal.timeout(45_000) }).then((r) => (r.ok ? (r.json() as Promise<T>) : null)).catch(() => null);

/** Recent settled tabs (attack runs excluded) from one network's feed: the first with at least 10 calls, read from its own record. */
async function findExample(base: string, net: Net, events?: FeedEvent[]): Promise<Example | null> {
  const evs = events ?? (await getJson<{ events: FeedEvent[] }>(`${base}/feed?limit=60`))?.events ?? [];
  const ids = evs.filter((e) => e.type === 'settle' && e.tag !== 'attack').slice(0, 8).map((e) => e.tab);
  const tabs = await Promise.all(ids.map((id) => getJson<TabRecord>(`${base}/tabs/${id}`)));
  const tab = tabs.find(isExample);
  if (!tab) return null;
  const info = await getJson<ServerInfo>(`${base}/.well-known/agenttab`);
  return { tab, net, hostedAgent: !!info?.features?.demo?.agentPub && info.features.demo.agentPub === tab.agentPub };
}

/** Example tab with real numbers: a mainnet tab when one qualifies, otherwise one from the network being viewed. Never aggregated. */
function useExampleTab(events: FeedEvent[], net: Net) {
  const key = events.filter((e) => e.type === 'settle' && e.tag !== 'attack').slice(0, 8).map((e) => e.tab).join(',');
  const [ex, setEx] = useState<Example | null>(null);
  useEffect(() => {
    let stop = false;
    (async () => {
      const main = SERVERS.mainnet && net !== 'mainnet' ? await findExample(SERVERS.mainnet, 'mainnet') : null;
      const found = main ?? (key ? await findExample(SERVERS[net], net, events) : null);
      if (!stop) setEx(found);
    })();
    return () => { stop = true; };
  }, [key, net]);
  return ex;
}

/** Mainnet tabs we know were funded from the author's own Paytaca wallet (docs/mainnet-proof.md), so the label can say so. */
const AUTHOR_FUNDED = new Set(['2e6bc19dd27c3225981a4c24e66b8874325f9b3955baa0639d7218145a89d7e8']);

/** Baseline: paying on-chain per call = one ~226-byte P2PKH payment per call (1 sat/byte), as the server's stats assume. */
const PER_CALL_FEE = 226;

function TxCount({ ex }: { ex: Example | null }) {
  const tab = ex?.tab;
  // Exact fees where they were read off the chain; otherwise the two txs' size (≈ sats at 1 sat/byte), or nothing.
  const known = tab?.settledTxid ? VERIFIED_SETTLES[tab.settledTxid] : undefined;
  const exactFee = known ? known.openFeeSats + known.settleFeeSats : undefined;
  const fee = exactFee ?? (tab?.openTxBytes && tab.settleTxBytes ? tab.openTxBytes + tab.settleTxBytes : undefined);
  const link = (txid: string, label: string) => (
    <a className="font-mono text-[12.5px] text-bch-2 hover:underline" href={explorerTx(ex!.net, txid)} target="_blank" rel="noreferrer">{label} {short(txid, 4)}</a>
  );
  return (
    <p className="text-sm text-muted">
      <b className="text-fg">A tab always takes 2 on-chain transactions, however many calls it covers</b>: one to open, one to close.
      The 5¢ demo stops at 3 calls to keep it short; 100 calls would still be 2 transactions, not 100.
      {tab && <> {ex!.net === 'mainnet' ? 'Mainnet tab' : 'Recent tab'}{ex!.hostedAgent ? (AUTHOR_FUNDED.has(tab.outpoint.txid)
        ? " (funded from the author's own Paytaca wallet, spent by our hosted demo agent)" : ' (funded by a visitor, spent by our hosted demo agent)') : ''}:{' '}
        <b className="text-fg">{plural(tab.requests, 'call')} · 2 transactions</b> ({link(tab.outpoint.txid, 'open')}, {link(tab.settledTxid!, 'close')}).</>}
      {tab && fee !== undefined && <> Its two transactions cost {exactFee === undefined ? 'about ' : ''}{sats(fee)} sats in miner fees{known ? ` (open ${sats(known.openFeeSats)} + settle ${sats(known.settleFeeSats)})` : ''}; paying each call on-chain would cost
        about {sats(tab.requests * PER_CALL_FEE)}, so a tab is <b className="text-bch-2">cheaper from {Math.floor(fee / PER_CALL_FEE) + 1} calls</b>.</>}
    </p>
  );
}

export function HowItWorks({ events, net, direct, advanced, advancedOpen, onAdvancedToggle }: {
  /** Newest first, as the feed holds them. */
  events: FeedEvent[]; net: Net;
  /** The 1¢ no-tab card (shown here when it isn't the hero action). */
  direct?: React.ReactNode;
  advanced: React.ReactNode; advancedOpen: boolean; onAdvancedToggle: (open: boolean) => void;
}) {
  const example = useExampleTab(events, net);
  return (
    <div id="how" className="grid scroll-mt-24 gap-5">
      <ol className="grid gap-3 sm:grid-cols-3">
        {STEPS.map((s, i) => (
          <li key={s.n} className="card card-lift relative rounded-2xl border border-line bg-panel p-4 sm:p-5">
            <div className="flex items-center justify-between gap-2">
              <span className="step-icon" aria-hidden>{s.icon}</span>
              <span className={`chip-tx ${s.zero ? 'is-zero' : ''}`} title={s.zero ? 'No on-chain transaction per call' : 'One on-chain transaction'}>{s.tx}</span>
            </div>
            <p className="mt-3 font-semibold"><span className="font-mono text-[12px] text-dim">0{i + 1}</span> {s.n}</p>
            <p className="mt-1 text-sm text-muted">{s.body}</p>
          </li>
        ))}
      </ol>
      <div className="card card-lift grid gap-3 rounded-2xl border border-line bg-panel p-5">
        <h3 className="flex items-center gap-3 font-semibold"><span className="step-icon" aria-hidden><svg width="18" height="18" viewBox="0 0 24 24" {...I}><path d="M12 3.5 5 6v5.5c0 4.2 2.9 7.6 7 9 4.1-1.4 7-4.8 7-9V6z" /><path d="m9.2 12 2 2 3.8-4" /></svg></span>Who can take what</h3>
        <p className="text-sm text-muted">
          A Bitcoin Cash covenant holds the money. The provider can claim only the highest voucher the agent signed, and the transaction must send
          the rest back to the owner. The agent can never withdraw. If the provider vanishes, the owner takes everything back after the timeout.
        </p>
        <TxCount ex={example} />
        <a className="tap text-sm font-medium text-bch-2 hover:underline" href={CONTRACT_SOURCE_URL || api.contractUrl()} target="_blank" rel="noreferrer">Read the covenant source ↗</a>
      </div>
      {direct}
      <details id="advanced" open={advancedOpen} onToggle={(e) => onAdvancedToggle((e.target as HTMLDetailsElement).open)}
        className="card group rounded-2xl border border-line bg-panel">
        <summary className="flex min-h-[52px] cursor-pointer list-none items-center justify-between gap-3 px-5 font-semibold">
          <span>Advanced: fund a tab for your own agent</span>
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line-2 bg-panel text-muted"><svg aria-hidden viewBox="0 0 12 12" fill="none" className="h-3.5 w-3.5 transition-transform group-open:rotate-180"><path d="M2.75 4.5 6 7.75 9.25 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
        </summary>
        <div className="border-t border-line">{advanced}</div>
      </details>
    </div>
  );
}
