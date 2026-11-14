import { useEffect, useMemo, useState } from 'react';
import { useWizardConnect, WizardConnectQRDialog } from '@wizardconnect/react';
import { Banner } from './components/Banner';
import { Hero } from './components/Hero';
import { Feed } from './components/Feed';
import { FundTab } from './components/FundTab';
import { MyTabs } from './components/MyTabs';
import { MAINNET_ENABLED, type Net } from './config';
import { api, selectServer, type ServerInfo } from './lib/api';
import { useFeed } from './hooks/useFeed';
import { burnerWallet, wizardWallet, type Wallet } from './lib/wallet';
import { sats, short } from './lib/format';

function Logo() {
  return (
    <a href="#" className="flex items-center gap-2.5">
      <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden><rect width="32" height="32" rx="8" fill="#0ac18e" /><path d="M9 22V10h7.5a4 4 0 0 1 0 8H13m0-8v12" stroke="#05140f" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
      <span className="text-[17px] font-bold tracking-tight">AgentTab</span>
    </a>
  );
}

function ConnectDialog({ net, onWizard, onBurner, onClose }: { net: Net; onWizard: () => void; onBurner: () => void; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-line-2 bg-panel p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold">Connect a wallet</h3>
        <p className="mt-1 text-sm text-muted">You fund the tab and get the remainder back. Your keys never leave your wallet.</p>
        <button onClick={onWizard} className="mt-5 flex w-full items-center justify-between rounded-xl border border-line-2 px-4 py-3.5 text-left hover:border-bch/60">
          <span><b>WizardConnect</b><span className="block text-xs text-muted">Scan with Paytaca or another WizardConnect wallet</span></span>
          <span className="text-bch-2">→</span>
        </button>
        <button onClick={onBurner} disabled={net !== 'chipnet'} className="mt-3 flex w-full items-center justify-between rounded-xl border border-line-2 px-4 py-3.5 text-left hover:border-bch/60 disabled:opacity-40">
          <span><b>Chipnet test wallet</b><span className="block text-xs text-muted">A throwaway key in this browser. Free test coins only.</span></span>
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
          <div key={n} className="rounded-2xl border border-line bg-panel p-5">
            <span className="font-mono text-sm text-bch">{n}</span>
            <h3 className="mt-2 text-lg font-semibold">{t}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">{d}</p>
          </div>
        ))}
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-line bg-panel p-5">
          <h3 className="text-sm font-semibold text-muted">What the covenant guarantees</h3>
          <ul className="mt-3 space-y-2 text-sm">
            {['Provider receives at most the signed amount', 'Owner receives exactly budget − amount', 'Vouchers only work on the tab they were signed for', 'Agent key can never withdraw', 'Owner refunds everything after the timeout'].map((x) => (
              <li key={x} className="flex gap-2"><span className="text-bch">✓</span>{x}</li>
            ))}
          </ul>
        </div>
        <div className="rounded-2xl border border-line bg-panel p-5">
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

  return (
    <div className="min-h-screen">
      <Banner />
      <header className="sticky top-0 z-40 border-b border-line bg-ink/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
          <Logo />
          <nav className="ml-6 hidden gap-5 text-sm text-muted md:flex">
            <a href="#feed" className="hover:text-fg">Live feed</a>
            <a href="#fund" className="hover:text-fg">Fund a tab</a>
            <a href="#how" className="hover:text-fg">How it works</a>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <select value={net} onChange={(e) => setNet(e.target.value as Net)} aria-label="Network"
              className="rounded-lg border border-line-2 bg-panel px-2.5 py-1.5 text-sm">
              <option value="chipnet">Chipnet (testnet)</option>
              <option value="mainnet" disabled={!MAINNET_ENABLED}>Mainnet{MAINNET_ENABLED ? '' : ' (soon)'}</option>
            </select>
            {wallet ? (
              <button onClick={() => { if (wallet.kind === 'wizard') wc.disconnect(); setWallet(null); }}
                className="rounded-lg border border-line-2 bg-panel px-3 py-1.5 font-mono text-sm" title="Disconnect">
                {walletLabel}
              </button>
            ) : (
              <button onClick={() => setShowConnect(true)} className="rounded-lg bg-bch px-3.5 py-1.5 text-sm font-semibold text-ink hover:bg-bch-2">Connect</button>
            )}
          </div>
        </div>
      </header>

      {(infoErr || error) && (
        <div className="border-b border-warn/30 bg-warn/10 px-4 py-2 text-center text-sm text-warn">
          Can't reach the AgentTab API on {net} ({infoErr ?? error}). Showing cached data only.
        </div>
      )}

      <Hero events={events} stats={stats} net={net} onFund={fund} />

      <main className="mx-auto grid max-w-6xl gap-6 px-4 lg:grid-cols-[1.1fr_1fr]">
        <Feed events={events} net={net} live={live} />
        <div className="grid content-start gap-6">
          <FundTab wallet={wallet} info={info} net={net} onConnect={() => setShowConnect(true)} onOpened={() => setOpened((n) => n + 1)} />
          <MyTabs wallet={wallet} info={info} net={net} refreshKey={opened} />
        </div>
      </main>

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
