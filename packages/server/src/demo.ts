// Demo agent hosted by the server: makes real paid calls to this server's own paywall, through the
// same HTTP 402 -> voucher flow an external agent uses (AgentTabClient from @agenttab/mcp).
// It spends from a tab a visitor funded for the demo agent (if given), else from its own demo tab.
import type { NetworkProvider } from 'cashscript';
import { DUST } from '@agenttab/covenant';
import { AgentTabClient } from '../../mcp/src/agent.ts';
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
}

export function createDemo(o: DemoOptions) {
  const agent = new AgentTabClient({
    agentPriv: o.agentPriv, network: o.network, provider: o.provider,
    maxBudgetSats: o.budgetSats, maxPriceSats: o.price, maxTotalSats: 10n ** 15n, tabBlocks: 144, stateFile: o.stateFile,
  });
  o.ledger.demoAgentPub = agent.agentPubHex;
  const perIp = new RateLimiter(1, o.perIpMs ?? 4_000);
  const global = new RateLimiter(20, 60_000);
  let lastCall: string | undefined;
  let lastError: string | undefined;
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

  async function call(preferTab?: string) {
    const q = questions[Math.floor(Math.random() * questions.length)];
    try {
      const r = await agent.fetchPaid(`${o.selfUrl()}${o.route}?q=${encodeURIComponent(q)}`, {}, o.price, { preferTab });
      lastCall = new Date().toISOString();
      lastError = undefined;
      await rollOver();
      return r;
    } catch (e) {
      lastError = (e as Error).message;
      throw e;
    }
  }

  const info = async () => ({
    enabled: true, agentPub: agent.agentPubHex, fundingAddress: agent.address, lastCall, lastError,
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
      const r = await call(prefer);
      const parsed = r.paid ? JSON.parse(r.body) : undefined;
      json(res, 200, r.paid
        ? { tab: r.tab, priceSats: r.priceSats, cumulativeSats: r.cumulativeSats, remainingSats: r.remainingSats, answer: parsed?.answer }
        : { status: r.status });
    } catch (e) {
      json(res, e instanceof PaymentError ? e.status : 503, { error: 'demo_failed', message: (e as Error).message });
    }
    return true;
  };

  let timer: ReturnType<typeof setInterval> | undefined;
  const startCron = (seconds: number) => {
    if (seconds <= 0) return;
    timer = setInterval(() => { call().catch((e) => console.error('demo cron', (e as Error).message)); }, seconds * 1000);
  };
  const stop = () => timer && clearInterval(timer);

  return { agent, call, info, handler, startCron, stop };
}
