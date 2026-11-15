import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useWizardConnect, WizardConnectQRDialog } from '@wizardconnect/react';
import { Banner } from './components/Banner';
import { Hero, type DemoRun, type LocalPaid } from './components/Hero';
import { IDLE_JOURNEY, type JourneyState } from './components/Journey';
import { ErrorBoundary } from './components/ErrorBoundary';
import { TabTimeline } from './components/TabTimeline';
import { Feed } from './components/Feed';
import { FundTab } from './components/FundTab';
import { MyTabs } from './components/MyTabs';
const CheatPanel = lazy(() => import('./components/CheatPanel').then((m) => ({ default: m.CheatPanel })));
import { DEMO_AGENT_PUB, MAINNET_ENABLED, explorerTx, type Net } from './config';
import { ApiError, api, selectServer, type FeedEvent, type ServerInfo, type TabRecord } from './lib/api';
import { useFeed } from './hooks/useFeed';
import { useTheme } from './hooks/useTheme';
import type { Wallet } from './lib/wallet';
import { ago, hex, loadWallet, sats, short, unhex } from './lib/format';

function Logo() {
  return (
    <a href="#" className="tap flex items-center gap-2.5" aria-label="AgentTab home">
      <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden><rect width="32" height="32" rx="8" fill="#0ac18e" /><path d="M9 22V10h7.5a4 4 0 0 1 0 8H13m0-8v12" stroke="#05140f" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
      <span className="text-[17px] font-bold tracking-tight">AgentTab</span>
    </a>
  );
}

function ConnectDialog({ net, onWizard, onBurner, onClose }: { net: Net; onWizard: () => void; onBurner: () => void; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-fg/40 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label="Connect a wallet">
      <div className="relative w-full max-w-md rounded-2xl border border-line-2 bg-panel p-6" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} aria-label="Close" className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-subtle hover:text-fg">✕</button>
        <h3 className="text-lg font-bold">Connect a wallet</h3>
        <p className="mt-1 text-sm text-muted">You fund the tab and get the remainder back. Your keys never leave your wallet.</p>
        <button onClick={onWizard} className="mt-5 flex w-full items-center justify-between rounded-xl border border-line-2 px-4 py-3.5 text-left hover:border-bch/60">
          <span><b>WizardConnect</b><span className="block text-xs text-muted">Scan with Paytaca or another WizardConnect wallet</span></span>
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
    <section id="mcp" className="card scroll-mt-24 min-w-0 rounded-2xl border border-line bg-panel p-6">
      <div className="min-w-0">
        <h2 className="text-xl font-bold">Give your own agent a tab</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          The MCP server lets Claude or any MCP agent pay a <code className="font-mono">402 bch-credit</code> API from a tab, with per-call and total spend caps.
          Tools: <code className="font-mono">fetch_paid</code>, <code className="font-mono">tab_status</code>, <code className="font-mono">close_tab</code>, <code className="font-mono">agent_info</code>.
        </p>
      </div>
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

export default function App() {
  const [net, setNet] = useState<Net>('chipnet');
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [infoErr, setInfoErr] = useState<string | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [showConnect, setShowConnect] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [opened, setOpened] = useState(0);
  const [myTabs, setMyTabs] = useState<TabRecord[]>([]);
  const [menu, setMenu] = useState(false);
  const [run, setRun] = useState<DemoRun>({ busy: false });
  const [demoIssue, setDemoIssue] = useState<string | undefined>();
  const [journey, setJourney] = useState<JourneyState>({ active: false, calls: 0 });
  const [infoSlow, setInfoSlow] = useState(false);
  const [wakeLong, setWakeLong] = useState(false);
  const [queued, setQueued] = useState(false);
  const pendingJourney = useRef(false);
  const wc = useWizardConnect({ dappName: 'AgentTab' });
  const theme = useTheme();

  selectServer(net);
  useEffect(() => {
    setInfo(null); setInfoErr(null); setInfoSlow(false); setWakeLong(false); setQueued(false);
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    // Free hosting sleeps when idle: after ~3 s without an answer, say so (and keep retrying).
    const slow = setTimeout(() => !stop && setInfoSlow(true), 3_000);
    const long = setTimeout(() => !stop && setWakeLong(true), 90_000);
    const load = () => api.info().then((i) => { if (!stop) { setInfo(i); setInfoErr(null); clearTimeout(slow); clearTimeout(long); setInfoSlow(false); setWakeLong(false); } })
      .catch((e) => { if (!stop) { setInfoErr(e.message); timer = setTimeout(load, 4000); } });
    load();
    const refreshInfo = setInterval(() => api.info().then((i) => !stop && setInfo(i)).catch(() => {}), 60_000);
    return () => { stop = true; clearTimeout(timer); clearTimeout(slow); clearTimeout(long); clearInterval(refreshInfo); };
  }, [net]);
  const { events, stats, live, error, lastSeen, stale, waking: feedWaking } = useFeed(net);
  const waking = !info && (infoSlow || feedWaking);

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

  const fund = () => {
    const adv = document.getElementById('advanced') as HTMLDetailsElement | null;
    if (adv) adv.open = true;
    document.getElementById('fund')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const walletLabel = useMemo(() => wallet ? short(wallet.address.split(':')[1] ?? wallet.address, 5) : null, [wallet]);
  const demoAgentPub = info?.features?.demo?.agentPub ?? DEMO_AGENT_PUB;
  const preferTab = useMemo(() => myTabs.find((t) => t.status === 'open' && t.agentPub === demoAgentPub.toLowerCase())?.id, [myTabs, demoAgentPub]);
  const journeyTab = journey.openTxid ? `${journey.openTxid}:0` : undefined;
  const mine = useMemo(() => new Set([...myTabs.map((t) => t.id), ...(journeyTab ? [journeyTab] : [])]), [myTabs, journeyTab]);
  // One tab for the receipt, the timeline and the step counter: the visitor's own if they have one, else the latest paid tab.
  const lastPaid = run.result?.ok ? run.result.r : undefined;
  const paysOn = (tab: string) => events.filter((e) => e.type === 'pay' && e.tab === tab).length;
  const visitorTab = journeyTab ?? preferTab ?? (lastPaid && mine.has(lastPaid.tab) ? lastPaid.tab : undefined)
    ?? myTabs.find((t) => events.some((e) => e.type === 'pay' && e.tab === t.id))?.id;
  const focusTab = visitorTab ?? events.find((e) => e.type === 'pay' && e.tag !== 'attack')?.tab;
  const journeyCalls = journeyTab ? Math.max(journey.calls, paysOn(journeyTab)) : journey.calls;
  const local: LocalPaid | undefined = focusTab && lastPaid?.tab === focusTab
    ? { tab: focusTab, calls: focusTab === journeyTab ? journeyCalls : 0, cumulative: BigInt(lastPaid.cumulativeSats), price: BigInt(lastPaid.priceSats) }
    : undefined;
  const openTabs = useMemo(() => new Set(myTabs.filter((t) => t.status === 'open').map((t) => t.id)), [myTabs]);
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 4000); return () => clearTimeout(t); }, [toast]);
  const prevWallet = useRef<Wallet | null>(null);
  useEffect(() => {
    if (wallet && !prevWallet.current && !pendingJourney.current && !journey.active) {
      wallet.balance().then((b) => setToast(`Connected · ${sats(b)} ${net === 'chipnet' ? 'test ' : ''}sats`)).catch(() => setToast('Connected'));
      document.getElementById('tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    prevWallet.current = wallet;
  }, [wallet]); // eslint-disable-line react-hooks/exhaustive-deps
  const demoEnabled = !!info?.features?.demo;

  useEffect(() => {
    if (!demoEnabled) { setDemoIssue(undefined); return; }
    // Only surface a problem if the house agent's own background job has been failing for over a minute.
    const load = () => api.demoInfo().then((d) => {
      const since = d.failingSince ? Date.parse(d.failingSince) : 0;
      setDemoIssue(since && Date.now() - since > 60_000 ? 'paused' : undefined);
    }).catch(() => {});
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [demoEnabled, net]);

  // ---- One-button journey: connect → coins → open → 3 paid calls → close → change back ----
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const FEE_ROOM = 600n;
  /** Target ≈5¢ (20k sats on chipnet), never below what 3 calls + dust + settle need, never above the balance. */
  function journeyBudget(price: bigint, balance: bigint) {
    const min = 3n * price + 546n + 1_000n;
    const target = net === 'chipnet' ? 20_000n
      : (info?.bchUsd ? BigInt(Math.ceil((0.05 / info.bchUsd) * 1e8)) : 25_000n);
    const capped = target > 30_000n ? 30_000n : target;
    const afford = ((balance - FEE_ROOM) / 100n) * 100n;
    const b = capped < afford ? capped : afford;
    return { budget: b < min ? min : b, min, enough: afford >= min };
  }
  async function runJourney(w: Wallet) {
    const upd = (p: Partial<JourneyState>) => setJourney((j) => ({ ...j, ...p }));
    try {
      if (!info) throw new Error('The provider API is unreachable right now.');
      const demoPub = info.features?.demo?.agentPub;
      if (!demoPub) throw new Error('This server is not hosting the demo agent.');
      const price = BigInt(info.routes[0]?.price ?? 1000);
      upd({ step: 'coins', note: 'Checking your balance…' });
      let bal = await w.balance();
      let plan = journeyBudget(price, bal);
      if (!plan.enough) {
        if (w.kind !== 'burner' || !info.features?.faucet) throw new Error(`Your wallet needs at least ${sats(plan.min + FEE_ROOM)} sats (a few cents) to open a tab.`);
        const t0 = Date.now();
        upd({ note: 'Getting free test coins…' });
        try { await api.drip(w.address); } catch (e) {
          if (e instanceof ApiError && e.status === 429) throw new Error(`${e.message} Meanwhile, press "Or just watch the demo agent pay once".`);
          if (!(e instanceof ApiError && e.status === 409)) throw e;
        }
        for (let i = 0; i < 16 && !plan.enough; i++) {
          await sleep(1000);
          upd({ note: `Getting free test coins… ${Math.round((Date.now() - t0) / 1000)} s` });
          bal = await w.balance();
          plan = journeyBudget(price, bal);
        }
        if (!plan.enough) throw new Error('The test coins have not shown up yet. Press "Try again" in a few seconds.');
      }
      const budget = plan.budget;
      upd({ budget, note: undefined });
      upd({ step: 'open', note: w.kind === 'wizard' ? 'Approve the transaction in your wallet…' : 'Signing and broadcasting…' });
      const { chain } = await loadWallet();
      const timeout = (await chain(net).getBlockHeight()) + 12;
      const txid = await w.openTab({ agentPub: unhex(demoPub), providerPub: unhex(info.providerPub), timeout: BigInt(timeout), budget });
      upd({ openTxid: txid, note: 'Registering the tab with the API…' });
      let reg: unknown = 'pending';
      for (let i = 0; i < 8 && reg; i++) {
        try { await api.register({ txid, vout: 0, ownerPub: hex(w.ownerPub), agentPub: demoPub, timeout }); reg = null; }
        catch (e) { reg = e; await sleep(1500); }
      }
      if (reg) throw reg;
      setOpened((n) => n + 1);
      const tab = `${txid}:0`;
      upd({ step: 'calls', calls: 0, note: undefined });
      for (let i = 1; i <= 3; i++) {
        let r;
        upd({ note: `Agent is calling ${info.routes[0]?.path ?? '/api/oracle'} (call ${i} of 3)…` });
        for (let tries = 0; !r; tries++) {
          try { r = await api.demoCall(tab, info.routes[0]?.path); } catch (e) {
            if (e instanceof ApiError && e.status === 429 && tries < 5) { upd({ note: 'API busy, retrying…' }); await sleep(2500); continue; }
            throw e;
          }
        }
        setRun({ busy: false, at: Date.now(), result: { ok: true, r } });
        upd({ calls: i });
        if (i < 3) await sleep(4300);
      }
      upd({ step: 'close', note: 'Settling: provider takes what was signed, the rest comes back…' });
      await sleep(800);
      const c = await api.closeTab(tab);
      upd({ closeTxid: c.txid, returned: c.returnedSats, action: c.action ?? 'settle', done: true, active: false, note: undefined });
      setOpened((n) => n + 1);
    } catch (e) {
      upd({ error: (e as Error).message, active: false, note: undefined });
    }
  }
  function startJourney() {
    if (!info) { setQueued(true); return; } // server still waking: start as soon as it answers
    setJourney({ active: true, step: 'wallet', calls: 0 });
    if (!wallet) {
      pendingJourney.current = true;
      // Chipnet: true one click, use a throwaway browser test wallet. Mainnet: ask for WizardConnect.
      if (net === 'chipnet') loadWallet().then(({ burnerWallet }) => setWallet(burnerWallet()));
      else setShowConnect(true);
      return;
    }
    void runJourney(wallet);
  }
  useEffect(() => {
    if (info && queued) { setQueued(false); startJourney(); }
  }, [info, queued]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (wallet && pendingJourney.current) { pendingJourney.current = false; void runJourney(wallet); }
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
    if (tab) document.getElementById('receipt')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    try {
      const r = await api.demoCall(target);
      setRun({ busy: false, at: Date.now(), result: { ok: true, r } });
      setDemoIssue(undefined);
      setOpened((n) => n + 1); // refresh tab cards (spent/remaining)
    } catch (e) {
      const m = (e as Error).message;
      const msg = /tab_closed|no longer usable|tab is (settled|cancelled|closed)/i.test(m) ? 'That tab is closed. Open a new one with the button above.' : m;
      setRun({ busy: false, at: Date.now(), result: { ok: false, msg } });
      setOpened((n) => n + 1);
    }
  }
  useEffect(() => { setMyTabs([]); }, [wallet, net]);

  return (
    <div className="min-h-screen overflow-x-clip">
      <Banner />
      <header className="sticky top-0 z-40 border-b border-line bg-ink/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <Logo />
          <nav className="ml-6 hidden gap-5 text-sm text-muted md:flex">
            <a href="#feed" className="hover:text-fg">Live feed</a>
            <a href="#fund" className="hover:text-fg">Fund a tab</a>
            <a href="#cheat" className="hover:text-fg">Try to cheat it</a>
            <a href="#how" className="hover:text-fg">How it works</a>
            <a href="#mcp" className="hover:text-fg">MCP</a>
          </nav>
          <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
            <button onClick={theme.next} aria-label={`Theme: ${theme.choice === 'system' ? 'auto' : theme.choice}. Switch theme`} title="Switch theme (light / dark / auto)"
              className="flex h-11 items-center gap-1.5 rounded-lg sm:h-9 border border-line-2 bg-panel px-2 text-xs sm:px-2.5 font-medium text-muted hover:text-fg">
              {theme.choice === 'light' ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
              ) : theme.choice === 'dark' ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></svg>
              )}
              <span className="hidden sm:inline">{theme.choice === 'light' ? 'Light' : theme.choice === 'dark' ? 'Dark' : 'Auto'}</span>
            </button>
            <select value={net} onChange={(e) => setNet(e.target.value as Net)} aria-label="Network"
              className="min-h-[44px] w-[92px] rounded-lg border border-line-2 bg-panel px-1.5 py-1.5 text-sm sm:min-h-0 sm:w-[112px] sm:px-2" title="Network (chipnet = testnet)">
              <option value="chipnet">Chipnet</option>
              <option value="mainnet" disabled={!MAINNET_ENABLED}>{MAINNET_ENABLED ? 'Mainnet' : 'Mainnet (at submission)'}</option>
            </select>
            {wallet ? (
              <div className="relative">
                <button onClick={() => setMenu((m) => !m)} className="flex min-h-[44px] items-center gap-2 rounded-lg border border-line-2 bg-panel px-3 py-1.5 font-mono text-sm sm:min-h-0" aria-expanded={menu}>
                  <span className="h-1.5 w-1.5 rounded-full bg-bch" />{walletLabel} <span className="text-dim">▾</span>
                </button>
                {menu && (
                  <div className="absolute right-0 mt-2 w-64 rounded-xl border border-line-2 bg-panel p-2 text-sm shadow-xl" onMouseLeave={() => setMenu(false)}>
                    <div className="px-2 py-1.5 text-xs text-dim">{wallet.label}</div>
                    <button className="w-full rounded-lg px-2 py-2 text-left hover:bg-subtle" onClick={() => { navigator.clipboard?.writeText(wallet.address); setMenu(false); }}>Copy address</button>
                    <button className="w-full rounded-lg px-2 py-2 text-left text-bad hover:bg-subtle" onClick={() => { if (wallet.kind === 'wizard') wc.disconnect(); setWallet(null); setMenu(false); }}>Disconnect</button>
                  </div>
                )}
              </div>
            ) : (
              <button onClick={() => setShowConnect(true)} className="min-h-[44px] whitespace-nowrap rounded-lg bg-bch px-2.5 py-1.5 text-sm font-semibold sm:min-h-0 sm:px-3 text-on-bch hover:bg-bch-hover">Connect</button>
            )}
          </div>
        </div>
      </header>

      {(infoErr || error) && !waking && (
        <div className="border-b border-warn/30 bg-warn/10 px-4 py-2 text-center text-sm text-warn">
          Reconnecting to the AgentTab API on {net}…{lastSeen ? ` Showing what was live ${ago(new Date(lastSeen).toISOString())}.` : ''}
        </div>
      )}

      <ErrorBoundary label="The hero">
      <Hero events={events} stats={stats} net={net} bchUsd={info?.bchUsd} demoEnabled={demoEnabled} demoIssue={demoIssue}
        tab={focusTab} tabIsMine={!!visitorTab} local={local} hasOpenTab={!!preferTab} run={run} onRun={() => runDemo()} onFund={fund}
        timeline={<TabTimeline events={events} net={net} tab={focusTab} mine={!!visitorTab} minCalls={focusTab && focusTab === journeyTab ? journeyCalls : 0} />}
        journey={{ ...journey, calls: journeyCalls }} onStartJourney={startJourney} onResetJourney={() => setJourney(IDLE_JOURNEY)}
        apiDown={!info} apiError={!!infoErr} waking={waking} wakeLong={wakeLong} queued={queued} lastSeen={lastSeen} stale={stale} />
      </ErrorBoundary>

      <main className="mx-auto grid max-w-6xl gap-6 px-4 lg:grid-cols-[1.1fr_1fr]">
        <div className="order-2 min-w-0 lg:order-1"><div className="lg:sticky lg:top-20"><ErrorBoundary label="The feed"><Feed events={events} net={net} live={live} mine={mine} waking={waking} /></ErrorBoundary></div></div>
        <div className="order-1 grid min-w-0 content-start gap-6 lg:order-2">
          <details id="advanced" className="group card rounded-2xl border border-line bg-panel open:bg-transparent open:border-transparent">
            <summary className="flex min-h-[52px] cursor-pointer list-none items-center justify-between gap-3 px-5 text-sm font-semibold group-open:hidden">
              <span>Advanced: fund a tab for your own agent <span className="font-normal text-dim">(agent key, budget, timeout, covenant)</span></span>
              <span className="text-dim">▾</span>
            </summary>
            <FundTab wallet={wallet} info={info} infoErr={infoErr} net={net} demoAgentPub={demoAgentPub} onConnect={() => setShowConnect(true)} onOpened={() => setOpened((n) => n + 1)}
              openTabs={wallet ? openTabs : undefined} />
          </details>
          <ErrorBoundary label="Your tabs"><MyTabs wallet={wallet} info={info} net={net} refreshKey={opened} demoAgentPub={demoAgentPub} onTabs={setMyTabs}
            onRunOnTab={demoEnabled ? (t) => runDemo3(t) : undefined} running={run.busy || (journey.active && (journey.step === 'calls' || journey.step === 'close'))} /></ErrorBoundary>
          <McpSection />
        </div>
      </main>

      {info?.features?.attacks && <ErrorBoundary label="The attack panel"><Suspense fallback={null}><CheatPanel net={net} /></Suspense></ErrorBoundary>}
      <div aria-hidden className="h-16" />

      {toast && (
        <div role="status" className="slide-in fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-bch/40 bg-panel px-4 py-2.5 text-sm shadow-xl">{toast}</div>
      )}

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-xs text-dim">
          <span>AgentTab · built for BCH BLAZE 2026 · {info ? <>provider <span className="font-mono">{short(info.providerPub, 6)}</span> · tip {info.tip} · {sats(info.routes[0]?.price)} sats/call</> : 'connecting…'}</span>
          <span>Covenant: CashScript 0.14 · Wallets: WizardConnect</span>
        </div>
      </footer>

      {showConnect && (
        <ConnectDialog net={net} onClose={() => { setShowConnect(false); if (pendingJourney.current && !wallet) { pendingJourney.current = false; setJourney({ active: false, calls: 0 }); } }}
          onBurner={() => { loadWallet().then(({ burnerWallet }) => setWallet(burnerWallet())); setShowConnect(false); }}
          onWizard={() => { setShowConnect(false); wc.connect(); setShowQr(true); }} />
      )}
      {showQr && wc.uri && wc.qrUri && wc.state !== 'connected' && (
        <WizardConnectQRDialog show uri={wc.uri} qrUri={wc.qrUri} onClose={() => { setShowQr(false); if (pendingJourney.current) { pendingJourney.current = false; setJourney({ active: false, calls: 0 }); } }}
          title="Connect with WizardConnect" subtitle="Scan with Paytaca to fund your agent's tab"
          theme={theme.resolved === 'dark'
            ? { dialogBackground: '#0e1513', headerBackground: '#0e1513', borderColor: '#2a3a35', titleColor: '#e8f3ef', subtitleColor: '#a3b8b1', uriRowBackground: '#131c19', uriTextColor: '#a3b8b1' }
            : { backdropColor: 'rgba(17,26,23,0.45)', dialogBackground: '#ffffff', headerBackground: '#ffffff', borderColor: '#e3ded2', titleColor: '#111a17', subtitleColor: '#44514c', uriRowBackground: '#f1eee6', uriTextColor: '#44514c', closeButtonColor: '#44514c', copyButtonColor: '#44514c', qrForeground: '#111a17' }} />
      )}
    </div>
  );
}
