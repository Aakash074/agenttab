import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Backdrop, PaymentStream } from './components/Backdrop';
import { useWizardConnect, WizardConnectQRDialog } from '@wizardconnect/react';
import { Banner } from './components/Banner';
import { Footer } from './components/Footer';
import { NetworkSelect } from './components/NetworkSelect';
import { Hero, ProofStrip, type DemoRun } from './components/Hero';
import { IDLE_JOURNEY, type JourneyState } from './components/Journey';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Ticket } from './components/Ticket';
import { Feed } from './components/Feed';
import { FundTab } from './components/FundTab';
import { DirectPay } from './components/DirectPay';
import { MyTabs } from './components/MyTabs';
import { HowItWorks } from './components/HowItWorks';
import { Sections, type SectionId } from './components/Sections';
const CheatPanel = lazy(() => import('./components/CheatPanel').then((m) => ({ default: m.CheatPanel })));
import { BANNER, DEMO_AGENT_PUB, MAINNET_ENABLED, SERVERS, type Net } from './config';
import { ApiError, api, humanError, isTransient, faucetOut, selectServer, type AttackRun, type ServerInfo, type Stats, type TabRecord } from './lib/api';
import { useFeed } from './hooks/useFeed';
import { useTheme } from './hooks/useTheme';
import type { Wallet } from './lib/wallet';
import { hex, loadWallet, sats, short, unhex } from './lib/format';
import { reducedMotion, scrollToId } from './lib/motion';
import { FEE_ROOM, assertJourneyWallet, journeyBudget, journeyCalls, mainnetTabCopy, WALLET_TAB_CALLS } from './lib/journeyPlan';
import { saveLocalTab } from './lib/localTabs';

function Logo() {
  return (
    <a href="#" className="tap flex shrink-0 items-center gap-2" aria-label="AgentTab home">
      <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden><rect width="32" height="32" rx="8" className="fill-bch" /><path d="M9 22V10h7.5a4 4 0 0 1 0 8H13m0-8v12" className="stroke-on-bch" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
      <span className="text-[17px] font-bold tracking-tight">AgentTab</span>
    </a>
  );
}

function ConnectDialog({ net, onWizard, onBurner, onClose, purpose }: { net: Net; onWizard: () => void; onBurner: () => void; onClose: () => void; purpose?: 'direct' }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-fg/40 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label="Connect a wallet">
      <div className="fade-in relative w-full max-w-md rounded-2xl border border-line-2 bg-panel p-6" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} aria-label="Close" className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-subtle hover:text-fg">✕</button>
        <h3 className="text-lg font-bold">Connect a wallet</h3>
        <p className="mt-1 text-sm text-muted">{purpose === 'direct' ? 'You approve the 1¢ payment in your wallet.' : 'You fund the tab and get the remainder back.'} Your keys never leave your wallet.</p>
        <button onClick={onWizard} className="mt-5 flex w-full items-center justify-between rounded-xl border border-line-2 px-4 py-3.5 text-left hover:border-bch/60">
          <span><b>WizardConnect</b><span className="block text-xs text-muted">Scan with Paytaca or another WizardConnect wallet{net === 'chipnet' ? '. Paytaca: switch to Chipnet in Settings first.' : ''}</span></span>
          <span className="text-bch-2">→</span>
        </button>
        <button onClick={onBurner} disabled={net !== 'chipnet'} className="mt-3 flex w-full items-center justify-between rounded-xl border border-line-2 px-4 py-3.5 text-left hover:border-bch/60 disabled:opacity-40">
          <span><b>Chipnet test wallet</b><span className="block text-xs text-muted">{net === 'chipnet' ? 'A throwaway key in this browser, topped up with free test coins in one click.' : 'Chipnet only. Switch the network to use it.'}</span></span>
          <span className="text-bch-2">→</span>
        </button>
      </div>
    </div>
  );
}

/** Mainnet 5¢ tab: says plainly it is real BCH and how the change comes back, then goes to WizardConnect. No test wallet here. */
function WalletTabDialog({ copy, error, connected, onGo, onClose }: {
  copy?: ReturnType<typeof mainnetTabCopy>; error?: string; connected: boolean; onGo: () => void; onClose: () => void;
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-fg/40 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label="Give an AI agent a 5¢ tab">
      <div className="fade-in relative w-full max-w-md rounded-2xl border border-line-2 bg-panel p-6" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} aria-label="Close" className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-subtle hover:text-fg">✕</button>
        <h3 className="pr-8 text-lg font-bold">Give an AI agent a 5¢ tab</h3>
        {copy ? (
          <>
            <p data-testid="tab-amount" className="mt-3 font-semibold text-fg">{copy.title}</p>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">{copy.body}</p>
            <p className="mt-2 text-xs leading-relaxed text-dim">{copy.refund} Your keys never leave your wallet.</p>
          </>
        ) : <p className="mt-3 text-sm text-bad">{error ?? 'Loading the live price…'}</p>}
        <button onClick={onGo} disabled={!copy} className="mt-5 flex w-full items-center justify-between rounded-xl border border-line-2 px-4 py-3.5 text-left hover:border-bch/60 disabled:opacity-50">
          <span><b>{connected ? 'Approve in your wallet' : 'WizardConnect'}</b><span className="block text-xs text-muted">{connected ? 'Your connected wallet asks you to approve one transaction.' : 'Scan with Paytaca on Mainnet (Chipnet off in Settings).'}</span></span>
          <span className="text-bch-2">→</span>
        </button>
      </div>
    </div>
  );
}

function McpSection() {
  const [copied, setCopied] = useState(false);
  const json = `{
  "mcpServers": {
    "agenttab": {
      "command": "node",
      "args": ["packages/mcp/src/index.ts"],
      "env": { "AGENT_WIF": "…", "MAX_BUDGET_SATS": "20000" }
    }
  }
}`;
  return (
    <section id="mcp" className="card min-w-0 scroll-mt-24 rounded-2xl border border-line bg-panel p-5 sm:p-6">
      <h3 className="text-lg font-semibold">Give Claude (or any MCP agent) a tab</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-muted">
        The MCP server pays any <code className="font-mono">402 bch-credit</code> API from a tab, with per-call and total spend caps.
        Tools: <code className="font-mono">fetch_paid</code>, <code className="font-mono">tab_status</code>, <code className="font-mono">close_tab</code>, <code className="font-mono">agent_info</code>.
      </p>
      <div className="relative mt-4 min-w-0 rounded-xl border border-line bg-panel-2">
        <button onClick={() => { navigator.clipboard?.writeText(json); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
          className="absolute right-2 top-2 min-h-[36px] rounded-lg border border-line-2 bg-panel px-3 text-xs font-medium text-muted hover:text-fg">
          {copied ? 'Copied' : 'Copy'}
        </button>
        <pre className="overflow-x-auto p-4 pr-20 font-mono text-[12px] leading-5 text-muted">{json}</pre>
      </div>
    </section>
  );
}

const NET_KEY = 'agenttab.net';
const isNet = (v: string | null): v is Net => v === 'chipnet' || (v === 'mainnet' && MAINNET_ENABLED);
/** First visit lands on mainnet. A ?net= link wins, then the visitor's own earlier choice (only explicit picks are saved). */
function initialNet(): Net {
  try {
    const q = new URLSearchParams(window.location.search).get('net');
    if (isNet(q)) return q;
    const saved = localStorage.getItem(NET_KEY);
    if (isNet(saved)) return saved;
  } catch { /* storage blocked */ }
  return MAINNET_ENABLED ? 'mainnet' : 'chipnet';
}

/** Old anchors (#cheat, #mcp, #fund…) still land in the right section. */
const HASH_SECTION: Record<string, SectionId> = { feed: 'feed', cheat: 'cheat', how: 'how', fund: 'how', advanced: 'how', direct: 'how', mcp: 'agent', tabs: 'agent', agent: 'agent' };
const hashSection = (): SectionId | undefined => HASH_SECTION[window.location.hash.slice(1)];

/** Mainnet stand-in for the attack panel: the attacks spend coins, so they run on chipnet against the same covenant. */
function CheatOnChipnet({ onSwitch }: { onSwitch: () => void }) {
  return (
    <div id="cheat" className="card card-lift rounded-2xl border border-line bg-panel p-5 sm:p-6">
      <h3 className="text-lg font-semibold">Seven real cheating transactions, all rejected by the node</h3>
      <p className="mt-1.5 max-w-2xl text-sm text-muted">They spend coins, so they run on Chipnet, against the same compiled covenant as Mainnet.</p>
      <button onClick={onSwitch} className="btn-primary mt-4 flex min-h-[48px] w-full items-center justify-center rounded-xl bg-bch px-6 font-semibold text-on-bch hover:bg-bch-hover sm:w-auto">
        Run the 7 attacks on Chipnet →
      </button>
    </div>
  );
}

/** Headline proof (calls, txs, cheats rejected). Mainnet has little traffic yet, so the strip reads Chipnet's numbers there. */
function useProof(net: Net, stats: Stats | null) {
  const [chip, setChip] = useState<Stats | null>(null);
  const [attacks, setAttacks] = useState<{ rejected: number; total: number } | undefined>();
  useEffect(() => {
    let stop = false;
    const base = SERVERS.chipnet;
    const load = () => {
      if (net !== 'chipnet') fetch(`${base}/feed?limit=1`, { signal: AbortSignal.timeout(45_000) }).then((r) => r.json()).then((f) => !stop && f?.stats && setChip(f.stats)).catch(() => {});
      fetch(`${base}/attacks`, { signal: AbortSignal.timeout(45_000) }).then((r) => r.json()).then((a) => {
        const run = a?.last as AttackRun | null;
        if (!stop && run?.results?.length) setAttacks({ rejected: run.results.filter((x) => x.outcome === 'rejected').length, total: run.results.length });
      }).catch(() => {});
    };
    load();
    const t = setInterval(load, 60_000);
    return () => { stop = true; clearInterval(t); };
  }, [net]);
  const s = net === 'chipnet' ? stats : chip;
  const onAttackRun = (run: AttackRun) => setAttacks({ rejected: run.results.filter((x) => x.outcome === 'rejected').length, total: run.results.length });
  return { calls: s?.paidCalls, txs: s?.onchainTxs, attacks, onAttackRun, chipnetNote: net !== 'chipnet' };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function App() {
  const [net, setNetState] = useState<Net>(initialNet);
  /** Scroll target to bring back into view once the newly picked network's API answers. */
  const scrollAfterSwitch = useRef<string | null>(null);
  const setNet = (n: Net, scrollTo?: string) => {
    scrollAfterSwitch.current = scrollTo ?? null;
    setNetState(n);
    try { localStorage.setItem(NET_KEY, n); } catch { /* ignore */ }
    try {
      const u = new URL(window.location.href);
      u.searchParams.set('net', n);
      window.history.replaceState(null, '', u.toString());
    } catch { /* ignore */ }
  };
  const tryChipnet = (scrollTo?: string) => setNet('chipnet', scrollTo);
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [infoErr, setInfoErr] = useState<string | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [showConnect, setShowConnect] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [opened, setOpened] = useState(0);
  const [myTabs, setMyTabs] = useState<TabRecord[]>([]);
  const [menu, setMenu] = useState(false);
  const [run, setRun] = useState<DemoRun>({ busy: false });
  // The "Paid N sats" note beside the house-agent button fades after a few seconds, so it never reads as a stale payment.
  const [runFresh, setRunFresh] = useState(false);
  useEffect(() => { if (!run.at) return; setRunFresh(true); const t = setTimeout(() => setRunFresh(false), 6000); return () => clearTimeout(t); }, [run.at]);
  const [journey, setJourney] = useState<JourneyState>(IDLE_JOURNEY);
  const [infoSlow, setInfoSlow] = useState(false);
  const [queued, setQueued] = useState(false);
  const [section, setSectionState] = useState<SectionId>(() => hashSection() ?? 'feed');
  const [advOpen, setAdvOpen] = useState(() => ['fund', 'advanced'].includes(window.location.hash.slice(1)));
  const pendingJourney = useRef(false);
  /** Resume target when a mainnet resume had to reconnect the wallet first. */
  const pendingFrom = useRef<JourneyState | undefined>(undefined);
  const [showTabConfirm, setShowTabConfirm] = useState(false);
  const pendingDirect = useRef(false);
  /** Bumped when the visitor closes the connect dialog / QR without connecting, so the 1¢ card goes back to idle. */
  const [connectCancelled, setConnectCancelled] = useState(0);
  const cancelDirect = () => { if (pendingDirect.current) { pendingDirect.current = false; setConnectCancelled((n) => n + 1); } };
  const wc = useWizardConnect({ dappName: 'AgentTab' });
  const theme = useTheme();

  const goSection = (id: SectionId, scroll = true, target = 'sections') => {
    setSectionState(id);
    if (scroll) requestAnimationFrame(() => scrollToId(target));
  };
  useEffect(() => {
    const onHash = () => { const s = hashSection(); if (s) { setSectionState(s); if (s === 'how' && /fund|advanced/.test(window.location.hash)) setAdvOpen(true); requestAnimationFrame(() => scrollToId(window.location.hash.slice(1))); } };
    if (hashSection()) setTimeout(onHash, 300);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  selectServer(net);
  useEffect(() => {
    setInfo(null); setInfoErr(null); setInfoSlow(false); setQueued(false);
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    // Free hosting sleeps when idle: after ~3 s without an answer, say so (and keep retrying).
    const slow = setTimeout(() => !stop && setInfoSlow(true), 3_000);
    const load = () => api.info().then((i) => { if (!stop) { setInfo(i); setInfoErr(null); clearTimeout(slow); setInfoSlow(false); } })
      .catch((e) => { if (!stop) { setInfoErr(e.message); timer = setTimeout(load, 4000); } });
    load();
    const refreshInfo = setInterval(() => api.info().then((i) => !stop && setInfo(i)).catch(() => {}), 60_000);
    return () => { stop = true; clearTimeout(timer); clearTimeout(slow); clearInterval(refreshInfo); };
  }, [net]);
  const { events, stats, live, error, waking: feedWaking } = useFeed(net);
  const waking = !info && (infoSlow || feedWaking);
  const proof = useProof(net, stats);

  useEffect(() => {
    if (wc.state === 'connected' && wc.manager) {
      const m = wc.manager;
      loadWallet().then(({ wizardWallet }) => { setWallet(wizardWallet(m, net, wc.walletName ?? 'WizardConnect wallet')); setShowQr(false); }).catch(() => { /* keys not ready yet */ });
    }
    if (wc.state === 'disconnected' && wallet?.kind === 'wizard') setWallet(null);
  }, [wc.state, wc.manager, wc.walletName, net]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!wallet || wallet.net === net) return;
    if (wallet.kind === 'wizard' && wc.manager) { const m = wc.manager; loadWallet().then(({ wizardWallet }) => setWallet(wizardWallet(m, net, wallet.label))); }
    else setWallet(null);
  }, [net]); // eslint-disable-line react-hooks/exhaustive-deps

  const fund = () => { setAdvOpen(true); goSection('how', true, 'advanced'); };
  const walletLabel = useMemo(() => wallet ? short(wallet.address.split(':')[1] ?? wallet.address, 4) : null, [wallet]);
  // The demo agent is hosted on chipnet (free, house agent) and, visitor-tabs-only, on mainnet.
  const demoAgentPub = info ? info.features?.demo?.agentPub ?? '' : net === 'chipnet' ? DEMO_AGENT_PUB : '';
  /** Mainnet demo mode: the agent only spends tabs a visitor funds from their own wallet (no house agent, no test coins). */
  const demoVisitorOnly = !!info?.features?.demo?.visitorTabsOnly;
  const preferTab = useMemo(() => myTabs.find((t) => t.status === 'open' && t.agentPub === demoAgentPub.toLowerCase())?.id, [myTabs, demoAgentPub]);
  const journeyTab = journey.openTxid ? `${journey.openTxid}:0` : undefined;
  const mine = useMemo(() => new Set([...myTabs.map((t) => t.id), ...(journeyTab ? [journeyTab] : [])]), [myTabs, journeyTab]);
  /** The run owns the ticket from the first click until it is reset, even through errors, so an open tab never disappears. */
  const inJourney = journey.active || !!journey.done || !!journey.error || !!journey.openTxid;
  const lastPaid = run.result?.ok ? run.result.r : undefined;
  const visitorTab = preferTab ?? (lastPaid && mine.has(lastPaid.tab) ? lastPaid.tab : undefined)
    ?? myTabs.find((t) => events.some((e) => e.type === 'pay' && e.tab === t.id))?.id;
  const focusTab = visitorTab ?? events.find((e) => e.type === 'pay' && e.tag !== 'attack')?.tab
    ?? events.find((e) => e.type === 'settle' && e.tag !== 'attack')?.tab;
  const openTabs = useMemo(() => new Set(myTabs.filter((t) => t.status === 'open').map((t) => t.id)), [myTabs]);
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 4000); return () => clearTimeout(t); }, [toast]);
  const prevWallet = useRef<Wallet | null>(null);
  useEffect(() => {
    if (wallet && !prevWallet.current && !pendingJourney.current && !pendingDirect.current && !journey.active) {
      wallet.balance().then((b) => setToast(`Connected · ${sats(b)} ${net === 'chipnet' ? 'test ' : ''}sats`)).catch(() => setToast('Connected'));
    }
    if (wallet) pendingDirect.current = false;
    prevWallet.current = wallet;
  }, [wallet]); // eslint-disable-line react-hooks/exhaustive-deps
  /** The house agent pays on its own here (chipnet). */
  const demoEnabled = !!info?.features?.demo && !demoVisitorOnly;
  /** The free demo (house agent, test coins, attacks) is not hosted on this network: point to chipnet instead. */
  const demoElsewhere = info ? !demoEnabled : net === 'mainnet';
  /** Mainnet: the 5¢ tab from the visitor's own wallet (WizardConnect) is available as the hero's second action. */
  const walletTabHere = net === 'mainnet' && demoVisitorOnly;
  const tabPrice = BigInt(info?.routes[0]?.price ?? 600);
  const tabQuote = useMemo(() => {
    if (!walletTabHere || !info) return { copy: undefined, error: undefined };
    try {
      const { budget } = journeyBudget({ net, price: tabPrice, calls: WALLET_TAB_CALLS, balance: 10n ** 12n, bchUsd: info.bchUsd });
      return { copy: mainnetTabCopy({ budget, bchUsd: info.bchUsd!, calls: WALLET_TAB_CALLS, price: tabPrice }), budget, error: undefined };
    } catch (e) { return { copy: undefined, error: (e as Error).message }; }
  }, [walletTabHere, info, net, tabPrice]);
  const attacksElsewhere = info ? !info.features?.attacks : net === 'mainnet';
  useEffect(() => {
    const id = scrollAfterSwitch.current;
    if (!info || !id) return;
    scrollAfterSwitch.current = null;
    requestAnimationFrame(() => scrollToId(id));
  }, [info]);

  // ---- One-button journey: connect → coins → open → N paid calls → settle → change back ----
  // N = 3 on the Chipnet test wallet; 10 from a real wallet (WizardConnect), which is the only way on Mainnet.
  async function runJourney(w: Wallet, from?: JourneyState) {
    const upd = (p: Partial<JourneyState>) => setJourney((j) => ({ ...j, ...p }));
    /** Retry through server hiccups (asleep, restarting, unreachable) with backoff, about a minute in all. */
    async function retrying<T>(fn: () => Promise<T>, allow429 = false): Promise<T> {
      const waits = [1500, 3000, 5000, 8000, 10_000, 10_000, 10_000, 10_000];
      for (let i = 0; ; i++) {
        try { const r = await fn(); if (i) upd({ hiccup: false }); return r; }
        catch (e) {
          if (!isTransient(e, allow429) || i >= waits.length) throw e;
          if (!(e instanceof ApiError && e.status === 429)) upd({ hiccup: true });
          await sleep(waits[i]);
        }
      }
    }
    /** The tab's final state if it is already closed (by an earlier close, or by the server on a restart). */
    const closedRecord = async (tab: string) => {
      try { const r = await api.tab(tab); return (r.status === 'settled' || r.status === 'cancelled') && r.settledTxid ? r : null; } catch { return null; }
    };
    const finishFrom = (r: TabRecord) => {
      const b = BigInt(r.budget), settled = BigInt(r.settledAmount ?? '0'), cancel = r.status === 'cancelled';
      upd({ step: 'close', closeTxid: r.settledTxid, settled: cancel ? '0' : settled.toString(), budget: b,
        returned: (cancel ? b - BigInt(r.settleTxBytes ?? 0) : b - settled).toString(), action: cancel ? 'cancel' : 'settle',
        done: true, active: false, note: undefined, hiccup: false, error: undefined });
      setOpened((n) => n + 1);
    };
    try {
      if (!info) throw new Error('The demo server is unreachable right now.');
      assertJourneyWallet(net, w); // mainnet: WizardConnect only, never a test wallet
      const total = journeyCalls(net, w.kind);
      upd({ total, walletKind: w.kind });
      const demoPub = info.features?.demo?.agentPub;
      if (!demoPub) throw new Error('This server is not hosting the demo agent.');
      const price = BigInt(info.routes[0]?.price ?? 1000);
      const path = info.routes[0]?.path ?? '/api/oracle';
      upd({ price, route: path });
      let txid = from?.openTxid;
      let timeout = from?.timeout;
      if (!txid || timeout === undefined) {
        upd({ step: 'coins', note: 'Checking your balance…' });
        let bal = await w.balance();
        const planFor = (balance: bigint) => journeyBudget({ net, price, calls: total, balance, bchUsd: info.bchUsd });
        let plan = planFor(bal);
        if (!plan.enough) {
          if (w.kind !== 'burner' || !info.features?.faucet) throw new Error(`Your wallet needs at least ${sats(plan.min + FEE_ROOM)} sats (a few cents) to open a tab.`);
          const t0 = Date.now();
          upd({ note: 'Getting free test coins…' });
          try { await retrying(() => api.drip(w.address)); } catch (e) {
            if (faucetOut(e)) {
              const wait = Number((e as ApiError).body?.retryInMs ?? 0);
              upd({ faucetOut: true, retryAt: wait ? Date.now() + wait : undefined });
              throw new Error((e as ApiError).status === 429 ? `${(e as ApiError).message} Meanwhile, the house agent can pay with its own tab.`
                : 'Free test coins are refilling. Watch the house agent open and settle a tab instead.');
            }
            if (!(e instanceof ApiError && e.status === 409)) throw e;
          }
          for (let i = 0; i < 16 && !plan.enough; i++) {
            await sleep(1000);
            upd({ note: `Getting free test coins… ${Math.round((Date.now() - t0) / 1000)} s` });
            bal = await w.balance();
            plan = planFor(bal);
          }
          if (!plan.enough) throw new Error('The test coins have not shown up yet. Try again in a few seconds.');
        }
        const budget = plan.budget;
        upd({ budget, capped: budget < plan.target, step: 'open', note: w.kind === 'wizard' ? 'Approve the transaction in your wallet…' : 'Opening the tab: 1 transaction' });
        const { lockTipOf } = await loadWallet();
        timeout = (await lockTipOf(net)) + 12; // lock units (10-min), see lockTip
        txid = await w.openTab({ agentPub: unhex(demoPub), providerPub: unhex(info.providerPub), timeout: BigInt(timeout), budget });
        // Remember it in this browser so "Your tabs" can offer the timeout refund even if the server forgets the tab.
        saveLocalTab({ net, txid, vout: 0, timeout, budget: budget.toString(), ownerPub: hex(w.ownerPub), agentPub: demoPub.toLowerCase(), providerPub: info.providerPub, at: new Date().toISOString() });
        upd({ openTxid: txid, timeout, note: undefined });
      }
      const tab = `${txid}:0`;
      // Register (idempotent). Right after broadcast the API may not see the coin yet, so short retries first.
      let reg: unknown = 'pending';
      for (let i = 0; i < 16 && reg; i++) {
        try { await api.register({ txid, vout: 0, ownerPub: hex(w.ownerPub), agentPub: demoPub, timeout }); reg = null; upd({ hiccup: false }); }
        catch (e) {
          reg = e;
          if (isTransient(e)) { upd({ hiccup: true }); await sleep(Math.min(10_000, 1500 * (i + 1))); }
          else if (i >= 7) break;
          else await sleep(1500);
        }
      }
      if (reg) { const r = await closedRecord(tab); if (r) return finishFrom(r); throw reg; }
      setOpened((n) => n + 1);
      if (from?.openTxid) { const r = await closedRecord(tab); if (r) return finishFrom(r); }
      upd({ step: 'calls', note: undefined });
      for (let i = (from?.calls ?? 0) + 1; i <= total; i++) {
        let r;
        try { r = await retrying(() => api.demoCall(tab, path), true); }
        catch (e) { const c = await closedRecord(tab); if (c) return finishFrom(c); throw e; }
        setRun({ busy: false, at: Date.now(), result: { ok: true, r } });
        upd({ calls: i, spent: BigInt(r.cumulativeSats), price: BigInt(r.priceSats) });
        if (i < total) await sleep(4300);
      }
      upd({ step: 'close', note: undefined });
      await sleep(800);
      let c;
      try { c = await retrying(() => api.closeTab(tab), true); }
      catch (e) {
        // The close may have gone through anyway (or a server restart closed the tab): read the tab before giving up.
        for (let k = 0; k < 5; k++) { const r = await closedRecord(tab); if (r) return finishFrom(r); await sleep(2000); }
        throw e;
      }
      upd({ closeTxid: c.txid, returned: c.returnedSats, settled: c.settledSats, action: c.action ?? 'settle', done: true, active: false, note: undefined, hiccup: false });
      setOpened((n) => n + 1);
    } catch (e) {
      upd({ error: humanError(e), active: false, note: undefined, hiccup: false });
    }
  }
  /** Mobile: the ticket sits under the button; bring it into view when the run starts. */
  const showTicket = () => {
    if (window.innerWidth >= 768) return;
    requestAnimationFrame(() => document.getElementById('ticket')?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center' }));
  };
  function startJourney() {
    if (!info) { setQueued(true); return; } // server still waking: start as soon as it answers
    // Mainnet: real BCH, so say exactly what happens first; the dialog goes on to WizardConnect.
    if (net === 'mainnet') { setShowTabConfirm(true); return; }
    setJourney({ active: true, step: 'wallet', calls: 0, note: net === 'chipnet' && !wallet ? 'Making a free test wallet…' : undefined });
    showTicket();
    if (!wallet) {
      pendingJourney.current = true;
      // Chipnet: true one click, use a throwaway browser test wallet. Mainnet: ask for WizardConnect.
      if (net === 'chipnet') loadWallet().then(({ burnerWallet }) => setWallet(burnerWallet()));
      else setShowConnect(true);
      return;
    }
    void runJourney(wallet);
  }
  /** Mainnet confirmation accepted: run with the connected wallet, or connect one via WizardConnect first. */
  function confirmWalletTab() {
    setShowTabConfirm(false);
    setJourney({ ...IDLE_JOURNEY, active: true, step: 'wallet', calls: 0, total: WALLET_TAB_CALLS, walletKind: 'wizard',
      note: wallet?.kind === 'wizard' ? undefined : 'Scan the code with Paytaca (Mainnet)…' });
    showTicket();
    if (wallet?.kind === 'wizard' && wallet.net === net) { void runJourney(wallet); return; }
    pendingJourney.current = true;
    wc.connect(); setShowQr(true);
  }
  /** Pick up the same tab where it stopped (never opens a second one). */
  async function resumeJourney() {
    const from = journey;
    setJourney((j) => ({ ...j, active: true, error: undefined }));
    showTicket();
    let w = wallet;
    if (!w && net === 'mainnet') {
      // Mainnet never falls back to a test wallet: reconnect the same wallet, then pick up the same tab.
      pendingJourney.current = true; pendingFrom.current = from;
      wc.connect(); setShowQr(true);
      return;
    }
    if (!w) w = (await loadWallet()).burnerWallet();
    void runJourney(w, from);
  }
  function restartJourney() { setJourney(IDLE_JOURNEY); startJourney(); }
  useEffect(() => {
    if (info && queued) { setQueued(false); startJourney(); }
  }, [info, queued]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (wallet && pendingJourney.current) {
      pendingJourney.current = false;
      const from = pendingFrom.current; pendingFrom.current = undefined;
      if (net === 'mainnet' && wallet.kind !== 'wizard') return; // never a test wallet on mainnet
      void runJourney(wallet, from);
    }
  }, [wallet]); // eslint-disable-line react-hooks/exhaustive-deps

  /** "Run agent on this tab": three paid calls, so closing afterwards settles instead of being waived. */
  async function runDemo3(tab: string) {
    for (let i = 0; i < 3; i++) {
      await runDemo(tab);
      if (i < 2) await sleep(4300);
    }
  }

  async function runDemo(tab?: string) {
    const target = tab ?? preferTab;
    setRun({ busy: true });
    if (tab) scrollToId('ticket');
    try {
      const r = await api.demoCall(target);
      setRun({ busy: false, at: Date.now(), result: { ok: true, r } });
      setOpened((n) => n + 1); // refresh tab cards (spent/remaining)
    } catch (e) {
      const m = (e as Error).message;
      const msg = /tab_closed|no longer usable|tab is (settled|cancelled|closed)/i.test(m) ? 'That tab is closed. Open a new one with the button above.'
        : e instanceof ApiError && e.status === 429 ? 'One call every few seconds, please.' : humanError(e);
      setRun({ busy: false, at: Date.now(), result: { ok: false, msg } });
      setOpened((n) => n + 1);
    }
  }
  useEffect(() => { setMyTabs([]); }, [wallet, net]);

  const direct = (hero: boolean) => (
    <DirectPay hero={hero} wallet={wallet} net={net} info={info} waking={waking} connectCancelled={connectCancelled}
      onConnect={() => { pendingDirect.current = true; setShowConnect(true); }} />
  );
  const houseAction = demoEnabled && !journey.active ? (
    <span className="flex items-center gap-3 text-[13px]">
      {run.result && !run.busy && runFresh && <span className={`fade-in ${run.result.ok ? 'text-bch-2' : 'text-warn'}`}>{run.result.ok ? `Paid ${sats(run.result.r.priceSats)} sats` : run.result.msg}</span>}
      <button type="button" onClick={() => runDemo()} disabled={run.busy || !info} className="tap font-medium text-bch-2 hover:underline disabled:opacity-60">
        {run.busy ? 'Paying…' : preferTab ? 'Pay once from your tab' : 'Make the house agent pay now'}
      </button>
    </span>
  ) : undefined;

  // Pause every CSS animation (header sheen, button sweeps…) while the tab is hidden.
  useEffect(() => {
    const f = () => document.documentElement.classList.toggle('tab-hidden', document.hidden);
    document.addEventListener('visibilitychange', f);
    return () => document.removeEventListener('visibilitychange', f);
  }, []);
  // The glass header gains a soft shadow once the page scrolls under it.
  useEffect(() => {
    const h = document.querySelector('.site-header');
    const f = () => h?.classList.toggle('is-scrolled', window.scrollY > 4);
    f(); window.addEventListener('scroll', f, { passive: true });
    return () => window.removeEventListener('scroll', f);
  }, []);

  return (
    <div className="relative isolate min-h-screen overflow-x-clip">
      <Backdrop />
      <PaymentStream />
      {/* One sticky glass header: the BLAZE banner and the nav move together, so the banner is never half-clipped. */}
      <div className="site-header sticky top-0 z-40">
      <div aria-hidden className="hdr-fx"><span className="hdr-sheen" /><span className="hdr-glint" /></div>
      <Banner />
      <header>
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-2.5">
          <Logo />
          <div className="ml-auto flex min-w-0 items-center gap-1.5 sm:gap-2">
            <button onClick={theme.next} aria-label={theme.resolved === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} title={theme.resolved === 'dark' ? 'Light theme' : 'Dark theme'}
              className="hidden h-10 w-10 place-items-center rounded-lg text-muted transition-colors hover:bg-subtle hover:text-fg sm:grid">
              {theme.resolved === 'dark' ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>
              )}
            </button>
            <NetworkSelect net={net} onChange={(n) => setNet(n)} mainnetEnabled={MAINNET_ENABLED} />
            {wallet ? (
              <div className="relative min-w-0">
                <button onClick={() => setMenu((m) => !m)} className="control max-w-[124px] gap-1.5 px-2.5 font-mono !text-[13px] !font-medium sm:max-w-none" aria-expanded={menu} aria-label="Wallet menu">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-bch" /><span className="truncate">{walletLabel}</span>
                  <svg className="h-3 w-3 shrink-0 text-dim" viewBox="0 0 12 12" fill="none" aria-hidden><path d="M2.75 4.5 6 7.75 9.25 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
                {menu && (
                  <div className="fade-in absolute right-0 mt-2 w-60 rounded-xl border border-line-2 bg-panel p-2 text-sm shadow-xl" onMouseLeave={() => setMenu(false)}>
                    <div className="px-2 py-1.5 text-xs text-dim">{wallet.label}</div>
                    <button className="w-full rounded-lg px-2 py-2 text-left hover:bg-subtle" onClick={() => { goSection('agent', true, 'tabs'); setMenu(false); }}>Your tabs</button>
                    <button className="w-full rounded-lg px-2 py-2 text-left hover:bg-subtle" onClick={() => { navigator.clipboard?.writeText(wallet.address); setMenu(false); }}>Copy address</button>
                    <button className="w-full rounded-lg px-2 py-2 text-left text-bad hover:bg-subtle" onClick={() => { if (wallet.kind === 'wizard') wc.disconnect(); setWallet(null); setMenu(false); }}>Disconnect</button>
                  </div>
                )}
              </div>
            ) : (
              <button onClick={() => setShowConnect(true)} className="control ring-sweep whitespace-nowrap px-3.5">Connect</button>
            )}
          </div>
        </div>
      </header>
      </div>

      {(infoErr || error) && !waking && (
        <div role="status" className="border-b border-warn/30 bg-warn/10 px-4 py-2 text-center text-sm text-warn">Reconnecting to the {net} server…</div>
      )}

      <ErrorBoundary label="The hero">
        <section className="mx-auto grid max-w-6xl gap-x-14 gap-y-7 px-4 pb-10 pt-9 md:grid-cols-[1fr_minmax(0,430px)] md:grid-rows-[auto_1fr] md:pb-8 md:pt-16">
          <div className="min-w-0 md:col-start-1 md:row-start-1">
            <Hero net={net} waking={waking} apiDown={!info} queued={queued} journey={journey} demoHere={!demoElsewhere}
              direct={direct(true)} onStart={journey.done || journey.error ? restartJourney : startJourney} onResume={() => void resumeJourney()} onTryChipnet={() => tryChipnet()}
              walletTab={walletTabHere ? { calls: WALLET_TAB_CALLS, hint: tabQuote.copy ? `Real BCH, ${tabQuote.copy.title.replace(/^Real BCH, /, '')} · ${WALLET_TAB_CALLS} calls · change back on settle` : 'Real BCH, ~5¢ from your wallet · change back on settle' } : undefined}
              houseBusy={run.busy} onHouse={demoEnabled ? () => { setJourney({ ...IDLE_JOURNEY, faucetOut: true, retryAt: journey.retryAt }); void runDemo(); } : undefined} />
          </div>
          <div className="min-w-0 md:col-start-2 md:row-span-2 md:row-start-1">
            <Ticket events={events} net={net} bchUsd={info?.bchUsd} journey={journey} inJourney={inJourney} tab={focusTab} mine={!!visitorTab && focusTab === visitorTab}
              waking={waking} onTryChipnet={demoElsewhere ? () => tryChipnet() : undefined}
              defaultPrice={BigInt(info?.routes[0]?.price ?? 1000)} route={info?.routes[0]?.path ?? '/api/oracle'} />
          </div>
          <div className="min-w-0 md:col-start-1 md:row-start-2">
            <ProofStrip calls={proof.calls} txs={proof.txs} attacks={proof.attacks} chipnetNote={proof.chipnetNote} onCheat={() => goSection('cheat')} />
          </div>
        </section>
      </ErrorBoundary>

      <main className="mx-auto max-w-6xl px-4 pb-16">
        <Sections active={section} onChange={(id) => goSection(id, false)} panels={{
          feed: <ErrorBoundary label="The feed"><Feed key={net} events={events} net={net} live={live} mine={mine} waking={waking} action={houseAction}
            onTryChipnet={demoElsewhere ? () => tryChipnet('sections') : undefined} /></ErrorBoundary>,
          cheat: attacksElsewhere ? <CheatOnChipnet onSwitch={() => tryChipnet('sections')} />
            : info?.features?.attacks ? <ErrorBoundary label="The attack panel"><Suspense fallback={<div className="skeleton h-40 rounded-2xl" />}><CheatPanel net={net} onResult={proof.onAttackRun} /></Suspense></ErrorBoundary>
            : <div className="skeleton h-40 rounded-2xl" aria-label="Loading" />,
          how: <HowItWorks stats={stats} bchUsd={info?.bchUsd} direct={demoElsewhere ? undefined : direct(false)} advancedOpen={advOpen} onAdvancedToggle={setAdvOpen}
            advanced={<FundTab wallet={wallet} info={info} infoErr={infoErr} net={net} demoAgentPub={demoElsewhere ? '' : demoAgentPub} onConnect={() => setShowConnect(true)} onOpened={() => setOpened((n) => n + 1)}
              openTabs={wallet ? openTabs : undefined} />} />,
          agent: (
            <div className="grid gap-5 lg:grid-cols-2">
              <McpSection />
              <ErrorBoundary label="Your tabs"><MyTabs wallet={wallet} info={info} net={net} refreshKey={opened} demoAgentPub={demoAgentPub} onTabs={setMyTabs}
                onConnect={() => setShowConnect(true)} onTryDemo={() => (demoElsewhere ? tryChipnet() : window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' }))}
                onRunOnTab={demoEnabled ? (t) => runDemo3(t) : undefined} running={run.busy || (journey.active && (journey.step === 'calls' || journey.step === 'close'))} /></ErrorBoundary>
            </div>
          ),
        }} />
      </main>

      {toast && (
        <div role="status" className="slide-in fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-line-2 bg-panel px-4 py-2.5 text-sm shadow-xl">{toast}</div>
      )}

      <Footer themeLabel={theme.resolved === 'dark' ? 'Light theme' : 'Dark theme'} onTheme={theme.next} />

      {showConnect && (
        <ConnectDialog net={net} purpose={pendingDirect.current ? 'direct' : undefined} onClose={() => { setShowConnect(false); cancelDirect(); if (pendingJourney.current && !wallet) { pendingJourney.current = false; setJourney(IDLE_JOURNEY); } }}
          onBurner={() => { loadWallet().then(({ burnerWallet }) => setWallet(burnerWallet())); setShowConnect(false); }}
          onWizard={() => { setShowConnect(false); wc.connect(); setShowQr(true); }} />
      )}
      {showTabConfirm && (
        <WalletTabDialog copy={tabQuote.copy} error={tabQuote.error} connected={wallet?.kind === 'wizard'} onGo={confirmWalletTab} onClose={() => setShowTabConfirm(false)} />
      )}
      {showQr && wc.uri && wc.qrUri && wc.state !== 'connected' && (
        <WizardConnectQRDialog show uri={wc.uri} qrUri={wc.qrUri} onClose={() => { setShowQr(false); cancelDirect(); if (pendingJourney.current) { pendingJourney.current = false; const f = pendingFrom.current; pendingFrom.current = undefined; setJourney(f ?? IDLE_JOURNEY); } }}
          title="Connect with WizardConnect" subtitle={pendingDirect.current ? 'Scan with Paytaca to pay 1¢ for an oracle answer'
            : net === 'mainnet' && pendingJourney.current ? `Scan with Paytaca (Mainnet) to fund a real-BCH tab of ${tabQuote.copy?.title.replace(/^Real BCH, /, '') ?? '~5¢'}`
            : "Scan with Paytaca to fund your agent's tab"}
          theme={theme.resolved === 'dark'
            ? { dialogBackground: '#0e1513', headerBackground: '#0e1513', borderColor: '#2a3a35', titleColor: '#e8f3ef', subtitleColor: '#a3b8b1', uriRowBackground: '#131c19', uriTextColor: '#a3b8b1' }
            : { backdropColor: 'rgba(17,26,23,0.45)', dialogBackground: '#ffffff', headerBackground: '#ffffff', borderColor: '#e3ded2', titleColor: '#111a17', subtitleColor: '#44514c', uriRowBackground: '#f1eee6', uriTextColor: '#44514c', closeButtonColor: '#44514c', copyButtonColor: '#44514c', qrForeground: '#111a17' }} />
      )}
    </div>
  );
}
