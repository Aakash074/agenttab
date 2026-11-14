import { useEffect, useMemo, useState } from 'react';
import { useWizardConnect, WizardConnectQRDialog } from '@wizardconnect/react';
import { Banner } from './components/Banner';
import { Hero, type DemoRun } from './components/Hero';
import { Feed } from './components/Feed';
import { FundTab } from './components/FundTab';
import { MyTabs } from './components/MyTabs';
import { CheatPanel } from './components/CheatPanel';
import { DEMO_AGENT_PUB, MAINNET_ENABLED, type Net } from './config';
import { api, selectServer, type ServerInfo, type TabRecord } from './lib/api';
import { useFeed } from './hooks/useFeed';
import { burnerWallet, wizardWallet, type Wallet } from './lib/wallet';
import { sats, short } from './lib/format';

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
    <section id="how" className="mx-auto max-w-6xl px-4 py-16">
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
  const wc = useWizardConnect({ dappName: 'AgentTab' });

  selectServer(net);
  useEffect(() => {
    setInfo(null); setInfoErr(null);
    api.info().then(setInfo).catch((e) => setInfoErr(e.message));
  }, [net]);
  const { events, stats, live, error } = useFeed(net);

  useEffect(() => {
    if (wc.state === 'connected' && wc.manager) {
      try { setWallet(wizardWallet(wc.manager, net, wc.walletName ?? 'WizardConnect wallet')); setShowQr(false); } catch { /* keys not ready yet */ }
    }
    if (wc.state === 'disconnected' && wallet?.kind === 'wizard') setWallet(null);
  }, [wc.state, wc.manager, wc.walletName, net]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (wallet && wallet.net !== net) setWallet(wallet.kind === 'wizard' && wc.manager ? wizardWallet(wc.manager, net, wallet.label) : null); }, [net]); // eslint-disable-line react-hooks/exhaustive-deps

  const fund = () => document.getElementById('fund')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const walletLabel = useMemo(() => wallet ? short(wallet.address.split(':')[1] ?? wallet.address, 5) : null, [wallet]);
  const demoAgentPub = info?.features?.demo?.agentPub ?? DEMO_AGENT_PUB;
  const preferTab = useMemo(() => myTabs.find((t) => t.status === 'open' && t.agentPub === demoAgentPub.toLowerCase())?.id, [myTabs, demoAgentPub]);
  const mine = useMemo(() => new Set(myTabs.map((t) => t.id)), [myTabs]);
  const demoEnabled = !!info?.features?.demo;

  useEffect(() => {
    if (!demoEnabled) { setDemoIssue(undefined); return; }
    const load = () => api.demoInfo().then((d) => setDemoIssue(d.healthy ? undefined : d.lastError)).catch(() => {});
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [demoEnabled, net]);

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
      setRun({ busy: false, at: Date.now(), result: { ok: false, msg: (e as Error).message } });
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
          Can't reach the AgentTab API on {net} ({infoErr ?? error}). Showing cached data only.
        </div>
      )}

      <Hero events={events} stats={stats} net={net} bchUsd={info?.bchUsd} demoEnabled={demoEnabled} demoIssue={demoIssue}
        pinTab={preferTab} run={run} onRun={() => runDemo()} onFund={fund} />

      <main className="mx-auto grid max-w-6xl gap-6 px-4 lg:grid-cols-[1.1fr_1fr]">
        <div className="order-2 min-w-0 lg:order-1"><Feed events={events} net={net} live={live} mine={mine} /></div>
        <div className="order-1 grid min-w-0 content-start gap-6 lg:order-2">
          <FundTab wallet={wallet} info={info} infoErr={infoErr} net={net} demoAgentPub={demoAgentPub} onConnect={() => setShowConnect(true)} onOpened={() => setOpened((n) => n + 1)}
            onRunOnTab={demoEnabled ? (t) => runDemo(t) : undefined} />
          <MyTabs wallet={wallet} info={info} net={net} refreshKey={opened} demoAgentPub={demoAgentPub} onTabs={setMyTabs}
            onRunOnTab={demoEnabled ? (t) => runDemo(t) : undefined} running={run.busy} />
        </div>
      </main>

      {info?.features?.attacks && <CheatPanel net={net} />}

      <HowItWorks />

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-xs text-dim">
          <span>AgentTab · built for BCH BLAZE 2026 · {info ? <>provider <span className="font-mono">{short(info.providerPub, 6)}</span> · tip {info.tip} · {sats(info.routes[0]?.price)} sats/call</> : 'connecting…'}</span>
          <span>Covenant: CashScript 0.14 · Wallets: WizardConnect</span>
        </div>
      </footer>

      {showConnect && (
        <ConnectDialog net={net} onClose={() => setShowConnect(false)}
          onBurner={() => { setWallet(burnerWallet()); setShowConnect(false); }}
          onWizard={() => { setShowConnect(false); wc.connect(); setShowQr(true); }} />
      )}
      {showQr && wc.uri && wc.qrUri && wc.state !== 'connected' && (
        <WizardConnectQRDialog show uri={wc.uri} qrUri={wc.qrUri} onClose={() => setShowQr(false)}
          title="Connect with WizardConnect" subtitle="Scan with Paytaca to fund your agent's tab"
          theme={{ dialogBackground: '#0e1513', headerBackground: '#0e1513', borderColor: '#2a3a35' }} />
      )}
    </div>
  );
}
