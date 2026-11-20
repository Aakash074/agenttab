// Demo agent hosted by the server: makes real paid calls to this server's own paywall, through the
// same HTTP 402 -> voucher flow an external agent uses (AgentTabClient from @agenttab/mcp).
// It spends from a tab a visitor funded for the demo agent (if given), else from its own demo tab.
import { SignatureTemplate, TransactionBuilder, type NetworkProvider } from 'cashscript';
import { DUST, p2pkhAddress, pubFromPriv } from '@agenttab/covenant';
import { AgentTabClient, TabClosedError } from '../../mcp/src/agent.ts';
import { MIN_SETTLE, PaymentError, type TabLedger } from './ledger.ts';
import { json, readBody, type ExtraHandler } from './app.ts';
import { RateLimiter, clientIp } from './ratelimit.ts';

export interface DemoOptions {
  ledger: TabLedger;
  provider: NetworkProvider;
  network: 'chipnet' | 'mainnet';
  agentPriv: Uint8Array;
  selfUrl: () => string;
  route: string;
  price: bigint;
  budgetSats: bigint;
  stateFile?: string;
  trustProxy?: boolean;
  perIpMs?: number;
  /** Provider key: settlement proceeds are swept back to the demo agent so the demo never runs dry (testnet only). */
  recycleFromPriv?: Uint8Array;
  /** Sweep provider proceeds to the demo agent when its balance drops below this. */
  recycleBelowSats?: bigint;
  /** With nobody watching the feed, the cron makes at most one call per this many seconds. */
  idleSeconds?: number;
  /** Mainnet mode: only spend tabs visitors funded for the demo agent; never open its own; no cron. */
  visitorTabsOnly?: boolean;
  /** Other paid routes the house agent sometimes calls, so the feed shows a realistic mix. */
  extraRoutes?: { path: string; price: bigint }[];
  /** Hard cap on what the demo agent may sign in total (state file), e.g. on mainnet. */
  maxTotalSats?: bigint;
  /** Cap on what the demo agent signs on any ONE visitor tab (mainnet: 10 calls), so nobody can drain a stranger's tab via /demo/call. */
  maxPerVisitorTabSats?: bigint;
}

export function createDemo(o: DemoOptions) {
  const agent = new AgentTabClient({
    agentPriv: o.agentPriv, network: o.network, provider: o.provider,
    maxBudgetSats: o.budgetSats, maxPriceSats: o.price, maxTotalSats: o.maxTotalSats ?? 10n ** 15n, tabBlocks: 144, stateFile: o.stateFile,
    allowOpen: !o.visitorTabsOnly,
  });
  o.ledger.demoAgentPub = agent.agentPubHex;
  const perIp = new RateLimiter(1, o.perIpMs ?? 4_000);
  const global = new RateLimiter(20, 60_000);
  let lastCall: string | undefined;
  let lastError: string | undefined;        // last failure of any call (diagnostics only)
  let lastErrorAt: string | undefined;
  let cronFailingSince: string | undefined;  // health is judged only by the background job's own calls
  let lastRecycle: string | undefined;

  /** Sweep the provider's settlement proceeds back to the demo agent (chipnet/mocknet only). */
  async function recycle(force = false) {
    if (!o.recycleFromPriv || o.network === 'mainnet') return undefined;
    const below = o.recycleBelowSats ?? 60_000n;
    if (!force && (await agent.balance()) >= below) return undefined;
    const from = p2pkhAddress(pubFromPriv(o.recycleFromPriv), 'chipnet');
    const utxos = (await o.provider.getUtxos(from)).filter((u) => !u.token);
    const total = utxos.reduce((a, u) => a + u.satoshis, 0n);
    if (total < 1_500n) return undefined;
    const build = (fee: bigint) => new TransactionBuilder({ provider: o.provider })
      .addInputs(utxos, new SignatureTemplate(o.recycleFromPriv!).unlockP2PKH())
      .addOutput({ to: agent.address, amount: total - fee });
    const fee = build(0n).getTransactionSize() + 2n;
    const tx = await build(fee).send();
    lastRecycle = tx.txid;
    return tx.txid;
  }
  const questions = ['What is BCH trading at?', 'Price check for my portfolio agent', 'Is the chain alive?', 'BCH/USD for a quote', 'Tip height + price, please'];

  /** Settle demo-owned tabs that can't pay another call (keeps the feed's settle rows coming). */
  async function rollOver() {
    for (const t of agent.tabs.values()) {
      if (t.closed || t.fundedBy !== 'agent') continue;
      const remaining = BigInt(t.budget) - DUST - BigInt(t.signed);
      if (remaining < o.price && BigInt(t.signed) >= MIN_SETTLE) {
        try { await agent.close(t.id); } catch (e) { console.error('demo roll-over settle failed', (e as Error).message); }
      }
    }
  }

  async function call(preferTab?: string, routePath?: string, fromCron = false) {
    if (o.visitorTabsOnly && !preferTab) throw new PaymentError('needs_tab', 'On mainnet the demo agent only spends a tab you funded for it. Fund one first.', 400);
    if (preferTab && o.maxPerVisitorTabSats !== undefined) {
      const signed = BigInt(agent.tabs.get(preferTab)?.signed ?? o.ledger.tabs.get(preferTab)?.highest?.amount ?? '0');
      if (signed + o.price > o.maxPerVisitorTabSats) throw new PaymentError('tab_call_cap', `The demo agent has made all its calls on this tab (${o.maxPerVisitorTabSats} sats). Close it to get the rest back.`, 409);
    }
    const q = questions[Math.floor(Math.random() * questions.length)];
    try {
      const pool = [{ path: o.route, price: o.price }, ...(o.extraRoutes ?? [])];
      const pick = routePath ? (pool.find((p) => p.path === routePath) ?? pool[0]) : (Math.random() < 0.6 ? pool[0] : pool[1 + Math.floor(Math.random() * (pool.length - 1))] ?? pool[0]);
      // Without an explicit visitor tab, the house agent only ever spends its own tabs.
      const r = await agent.fetchPaid(`${o.selfUrl()}${pick.path}?q=${encodeURIComponent(q)}`, {}, o.price, { preferTab, ownTabsOnly: !preferTab });
      lastCall = new Date().toISOString();
      lastError = undefined;
      if (fromCron) cronFailingSince = undefined;
      await rollOver();
      recycle().catch((e) => console.error('demo recycle', (e as Error).message));
      return r;
    } catch (e) {
      lastError = (e as Error).message;
      lastErrorAt = new Date().toISOString();
      if (fromCron && !cronFailingSince) cronFailingSince = lastErrorAt;
      console.error('demo call failed:', lastError);
      throw e;
    }
  }

  const info = async () => ({
    enabled: true, agentPub: agent.agentPubHex, fundingAddress: agent.address, lastCall, lastError, lastErrorAt, lastRecycle,
    viewers: o.ledger.viewers, healthy: !cronFailingSince, failingSince: cronFailingSince,
    balanceSats: (await agent.balance().catch(() => 0n)).toString(),
  });

  const handler: ExtraHandler = async (req, res, url) => {
    if (url.pathname === '/demo' && req.method === 'GET') { json(res, 200, await info()); return true; }
    if (url.pathname !== '/demo/call' || req.method !== 'POST') return false;
    const wait = perIp.take(clientIp(req, !!o.trustProxy)) || global.take('all');
    if (wait) { json(res, 429, { error: 'rate_limited', retryInMs: wait }); return true; }
    const body = await readBody(req).catch(() => ({}));
    const prefer = typeof body.tab === 'string' && /^[0-9a-f]{64}:\d+$/.test(body.tab) ? body.tab : undefined;
    try {
      const r = await call(prefer, typeof body.route === 'string' ? body.route : undefined);
      const parsed = r.paid ? JSON.parse(r.body) : undefined;
      json(res, 200, r.paid
        ? { tab: r.tab, priceSats: r.priceSats, cumulativeSats: r.cumulativeSats, remainingSats: r.remainingSats, answer: parsed?.answer }
        : { status: r.status });
    } catch (e) {
      if (e instanceof TabClosedError) json(res, 409, { error: 'tab_closed', message: 'That tab is closed. Open a new one to keep paying.' });
      else json(res, e instanceof PaymentError ? e.status : 503, { error: 'demo_failed', message: (e as Error).message });
    }
    return true;
  };

  let timer: ReturnType<typeof setInterval> | undefined;
  /** Every `seconds` while someone watches the live feed; otherwise at most once per idleSeconds (default 600). */
  const startCron = (seconds: number) => {
    if (seconds <= 0 || o.visitorTabsOnly) return;
    const idle = (o.idleSeconds ?? 600) * 1000;
    timer = setInterval(() => {
      const since = lastCall ? Date.now() - Date.parse(lastCall) : Infinity;
      if (o.ledger.viewers === 0 && since < idle) return;
      call(undefined, undefined, true).catch(() => {});
    }, seconds * 1000);
  };
  const stop = () => timer && clearInterval(timer);

  return { agent, call, info, handler, startCron, stop, recycle, cronTick: () => call(undefined, undefined, true) };
}
