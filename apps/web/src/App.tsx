import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useWizardConnect, WizardConnectQRDialog } from '@wizardconnect/react';
import { Banner } from './components/Banner';
import { Hero, type DemoRun } from './components/Hero';
import { IDLE_JOURNEY, type JourneyState } from './components/Journey';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Feed } from './components/Feed';
import { FundTab } from './components/FundTab';
import { MyTabs } from './components/MyTabs';
const CheatPanel = lazy(() => import('./components/CheatPanel').then((m) => ({ default: m.CheatPanel })));
import { DEMO_AGENT_PUB, MAINNET_ENABLED, type Net } from './config';
import { ApiError, api, selectServer, type ServerInfo, type TabRecord } from './lib/api';
import { useFeed } from './hooks/useFeed';
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
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label="Connect a wallet">
      <div className="relative w-full max-w-md rounded-2xl border border-line-2 bg-panel p-6" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} aria-label="Close" className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-white/5 hover:text-fg">✕</button>
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

function HowItWorks() {
  const steps = [
    ['01', 'Open a tab', 'You lock a budget in a CashScript covenant: owner = you, agent = your agent\'s key, provider = the API. One on-chain transaction.'],
    ['02', 'The agent pays per call', 'On a 402, the agent signs a voucher for the running total, bound to this exact tab. Off-chain, instant, no fees.'],
    ['03', 'Settle or refund', 'The provider settles once with the highest voucher, and the covenant forces the rest back to you. If the provider vanishes, you refund after the timeout.'],
  ];
  return (
    <section id="how" className="scroll-mt-24 mx-auto max-w-6xl px-4 py-16">
      <h2 className="text-3xl font-bold tracking-tight">A bar tab, enforced by Bitcoin Cash script</h2>
      <p className="mt-2 max-w-2xl text-muted">x402-style HTTP payments, but the agent doesn't need a transaction per call or a custodial balance. Every rule below is checked by the covenant, not by us.</p>
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {steps.map(([n, t, d]) => (
          <div key={n} className="min-w-0 rounded-2xl border border-line bg-panel p-5">
            <span className="font-mono text-sm text-bch">{n}</span>
            <h3 className="mt-2 text-lg font-semibold">{t}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">{d}</p>
          </div>
        ))}
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="min-w-0 rounded-2xl border border-line bg-panel p-5">
          <h3 className="text-sm font-semibold text-muted">What the covenant guarantees</h3>
          <ul className="mt-3 space-y-2 text-sm">
            {['Provider receives at most the signed amount', 'Owner receives exactly budget − amount', 'Vouchers only work on the tab they were signed for', 'Agent key can never withdraw', 'Owner refunds everything after the timeout'].map((x) => (
              <li key={x} className="flex gap-2"><span className="text-bch">✓</span>{x}</li>
            ))}
          </ul>
        </div>
        <div className="min-w-0 rounded-2xl border border-line bg-panel p-5">
          <h3 className="text-sm font-semibold text-muted">Give your agent a tab (MCP)</h3>
          <pre className="mt-3 overflow-x-auto rounded-lg bg-ink p-3 font-mono text-[12px] leading-5 text-muted">{`{
  "mcpServers": {
    "agenttab": {
      "command": "node",
      "args": ["packages/mcp/src/index.ts"],
      "env": { "AGENT_WIF": "…", "MAX_BUDGET_SATS": "20000" }
    }
  }
}`}</pre>
          <p className="mt-2 text-xs text-dim">Tools: <code>fetch_paid</code>, <code>tab_status</code>, <code>close_tab</code>, <code>agent_info</code></p>
        </div>
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
  const pendingJourney = useRef(false);
  const wc = useWizardConnect({ dappName: 'AgentTab' });

  selectServer(net);
  useEffect(() => {
    setInfo(null); setInfoErr(null);
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = () => api.info().then((i) => { if (!stop) { setInfo(i); setInfoErr(null); } })
      .catch((e) => { if (!stop) { setInfoErr(e.message); timer = setTimeout(load, 4000); } });
    load();
    const refreshInfo = setInterval(() => api.info().then((i) => !stop && setInfo(i)).catch(() => {}), 60_000);
    return () => { stop = true; clearTimeout(timer); clearInterval(refreshInfo); };
  }, [net]);
  const { events, stats, live, error, lastSeen, stale } = useFeed(net);

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
  const mine = useMemo(() => new Set(myTabs.map((t) => t.id)), [myTabs]);
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
    const load = () => api.demoInfo().then((d) => setDemoIssue(d.healthy ? undefined : d.lastError)).catch(() => {});
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
        for (let tries = 0; !r; tries++) {
          try { r = await api.demoCall(tab); } catch (e) {
            if (e instanceof ApiError && e.status === 429 && tries < 5) { await sleep(2500); continue; }
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
    if (wallet && pendingJourney.current) { pendingJourney.current = false; void runJourney(wallet); }
  }, [wallet]); // eslint-disable-line react-hooks/exhaustive-deps

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
          </nav>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <select value={net} onChange={(e) => setNet(e.target.value as Net)} aria-label="Network"
              className="w-[112px] rounded-lg border border-line-2 bg-panel px-2 py-1.5 text-sm" title="Network (chipnet = testnet)">
              <option value="chipnet">Chipnet</option>
              <option value="mainnet" disabled={!MAINNET_ENABLED}>{MAINNET_ENABLED ? 'Mainnet' : 'Mainnet — live at submission'}</option>
            </select>
            {wallet ? (
              <div className="relative">
                <button onClick={() => setMenu((m) => !m)} className="flex items-center gap-2 rounded-lg border border-line-2 bg-panel px-3 py-1.5 font-mono text-sm" aria-expanded={menu}>
                  <span className="h-1.5 w-1.5 rounded-full bg-bch" />{walletLabel} <span className="text-dim">▾</span>
                </button>
                {menu && (
                  <div className="absolute right-0 mt-2 w-64 rounded-xl border border-line-2 bg-panel p-2 text-sm shadow-xl" onMouseLeave={() => setMenu(false)}>
                    <div className="px-2 py-1.5 text-xs text-dim">{wallet.label}</div>
                    <button className="w-full rounded-lg px-2 py-2 text-left hover:bg-white/5" onClick={() => { navigator.clipboard?.writeText(wallet.address); setMenu(false); }}>Copy address</button>
                    <button className="w-full rounded-lg px-2 py-2 text-left text-bad hover:bg-white/5" onClick={() => { if (wallet.kind === 'wizard') wc.disconnect(); setWallet(null); setMenu(false); }}>Disconnect</button>
                  </div>
                )}
              </div>
            ) : (
              <button onClick={() => setShowConnect(true)} className="whitespace-nowrap rounded-lg bg-bch px-3 py-1.5 text-sm font-semibold text-ink hover:bg-bch-2">Connect</button>
            )}
          </div>
        </div>
      </header>

      {(infoErr || error) && (
        <div className="border-b border-warn/30 bg-warn/10 px-4 py-2 text-center text-sm text-warn">
          Reconnecting to the AgentTab API on {net}…{lastSeen ? ` Showing what was live ${ago(new Date(lastSeen).toISOString())}.` : ''}
        </div>
      )}

      <ErrorBoundary label="The hero">
      <Hero events={events} stats={stats} net={net} bchUsd={info?.bchUsd} demoEnabled={demoEnabled} demoIssue={demoIssue}
        pinTab={preferTab} run={run} onRun={() => runDemo()} onFund={fund}
        journey={journey} onStartJourney={startJourney} onResetJourney={() => setJourney(IDLE_JOURNEY)}
        apiDown={!info} lastSeen={lastSeen} stale={stale} />
      </ErrorBoundary>

      <main className="mx-auto grid max-w-6xl gap-6 px-4 lg:grid-cols-[1.1fr_1fr]">
        <div className="order-2 min-w-0 lg:order-1"><div className="lg:sticky lg:top-20"><ErrorBoundary label="The feed"><Feed events={events} net={net} live={live} mine={mine} /></ErrorBoundary></div></div>
        <div className="order-1 grid min-w-0 content-start gap-6 lg:order-2">
          <details id="advanced" className="group rounded-2xl border border-line bg-panel open:bg-transparent open:border-transparent">
            <summary className="flex min-h-[52px] cursor-pointer list-none items-center justify-between gap-3 px-5 text-sm font-semibold group-open:hidden">
              <span>Advanced: fund a tab for your own agent <span className="font-normal text-dim">(agent key, budget, timeout, covenant)</span></span>
              <span className="text-dim">▾</span>
            </summary>
            <FundTab wallet={wallet} info={info} infoErr={infoErr} net={net} demoAgentPub={demoAgentPub} onConnect={() => setShowConnect(true)} onOpened={() => setOpened((n) => n + 1)}
              onRunOnTab={demoEnabled ? (t) => runDemo(t) : undefined} openTabs={wallet ? openTabs : undefined} />
          </details>
          <ErrorBoundary label="Your tabs"><MyTabs wallet={wallet} info={info} net={net} refreshKey={opened} demoAgentPub={demoAgentPub} onTabs={setMyTabs}
            onRunOnTab={demoEnabled ? (t) => runDemo(t) : undefined} running={run.busy} /></ErrorBoundary>
        </div>
      </main>

      {info?.features?.attacks && <ErrorBoundary label="The attack panel"><Suspense fallback={null}><CheatPanel net={net} /></Suspense></ErrorBoundary>}

      <HowItWorks />

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
          theme={{ dialogBackground: '#0e1513', headerBackground: '#0e1513', borderColor: '#2a3a35' }} />
      )}
    </div>
  );
}
