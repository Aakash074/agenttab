import { SERVERS, type Net } from '../config';

export interface FeedEvent {
  id: number;
  at: string;
  type: 'open' | 'pay' | 'settle' | 'cancel' | 'expired' | 'closed' | 'direct';
  /** Tab id, or `direct:<invoiceId>` for a 1¢ direct payment. */
  tab: string;
  txid?: string;
  amount?: string;
  price?: string;
  route?: string;
  auto?: boolean;
  contract?: string;
  agent?: string;
  demo?: boolean;
  tag?: string;
  restored?: boolean;
  /** Restored settle: calls derived from the settle tx (amount ÷ price). */
  calls?: number;
  /** Restored unconfirmed tx whose time is unknown. */
  timeUnknown?: boolean;
}

export interface Stats {
  tabs: number; openTabs: number; paidCalls: number; vouchedSats: string; tip: number;
  onchainTxs?: number; feeSats?: number; perCallTxs?: number; perCallFeeSats?: number; restoredTabs?: number;
}

export interface AttackResult { id: string; title: string; attempt: string; layer: string; outcome: 'rejected' | 'ACCEPTED'; message: string; attemptedTxid?: string }
export interface AttackRun { at: string; network: string; tab: string; contract: string; openTxid: string; results: AttackResult[]; honestSettleTxid?: string; ms: number }

export interface TabRecord {
  id: string;
  outpoint: { txid: string; vout: number };
  ownerPub: string;
  agentPub: string;
  timeout: number;
  budget: string;
  contractAddress: string;
  highest?: { amount: string; sig: string };
  requests: number;
  openedAt: string;
  status: 'open' | 'settled' | 'cancelled' | 'expired' | 'closed';
  settledTxid?: string;
  settledAmount?: string;
  settleTxBytes?: number;
}

export interface ServerInfo {
  providerPub: string;
  network: 'chipnet' | 'mainnet';
  tip: number;
  safetyBlocks: number;
  routes: { path: string; price: string; description: string }[];
  bchUsd?: number;
  features?: {
    maxBudgetSats?: string | null;
    demo?: { agentPub: string; cronSeconds: number };
    faucet?: { dripSats: string; address: string };
    attacks?: boolean;
    direct?: { path: string; payTo: string; priceSats: string };
  };
}

export interface DemoInfo { enabled: boolean; agentPub: string; lastCall?: string; lastError?: string; lastErrorAt?: string; healthy: boolean; failingSince?: string; balanceSats: string }

export class ApiError extends Error {
  status: number;
  body: Record<string, unknown>;
  constructor(status: number, body: Record<string, unknown>, msg: string) { super(msg); this.status = status; this.body = body; }
}

export interface DirectInvoice { invoiceId: string; q: string; payTo: string; amountSats: string; network: string; opReturn: string[]; expiresAt: string }
export interface DirectAnswer { invoiceId: string; txid: string; amountSats: string; answer?: string; q?: string; repeat?: boolean }

export interface DemoCall { tab: string; priceSats: string; cumulativeSats: string; remainingSats: string; answer?: string }

let SERVER = SERVERS.chipnet;
export const selectServer = (net: Net) => { SERVER = SERVERS[net]; };

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(SERVER + path, init);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, body, body.message ?? body.error ?? `${r.status}`);
  return body as T;
}

export const api = {
  info: () => j<ServerInfo>('/.well-known/agenttab', { signal: AbortSignal.timeout(45_000) }),
  feed: (since = 0) => j<{ network: string; epoch?: string; stats: Stats; events: FeedEvent[] }>(`/feed?since=${since}&limit=60`, { signal: AbortSignal.timeout(45_000) }),
  tabsByOwner: (owner: string) => j<{ tip: number; tabs: TabRecord[] }>(`/tabs?owner=${owner}`),
  register: (b: { txid: string; vout: number; ownerPub: string; agentPub: string; timeout: number }) =>
    j<TabRecord>('/tabs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }),
  streamUrl: () => `${SERVER}/feed/stream`,
  contractUrl: () => `${SERVER}/contract`,
  demoCall: (tab?: string, route?: string) => j<DemoCall>('/demo/call', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...(tab ? { tab } : {}), ...(route ? { route } : {}) }) }),
  demoInfo: () => j<DemoInfo>('/demo'),
  attacks: () => j<{ last: AttackRun | null; running: boolean }>('/attacks'),
  runAttacks: () => j<{ last: AttackRun | null; running?: boolean; cached?: boolean; retryInMs?: number }>('/attacks/run', { method: 'POST' }),
  closeTab: (id: string) => j<{ txid: string; action: 'settle' | 'cancel'; settledSats: string; returnedSats: string }>(`/tabs/${id}/close`, { method: 'POST' }),
  directInvoice: (q: string) => j<DirectInvoice>('/direct', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ q }), signal: AbortSignal.timeout(60_000) }),
  directPay: (id: string, rawTx: string) => j<DirectAnswer>(`/direct/${id}/pay`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rawTx }), signal: AbortSignal.timeout(60_000) }),
  drip: (address: string) => j<{ txid: string; sats: string }>('/faucet/drip', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address }) }),
};
