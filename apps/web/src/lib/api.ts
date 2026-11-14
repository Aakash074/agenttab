import { SERVERS, type Net } from '../config';

export interface FeedEvent {
  id: number;
  at: string;
  type: 'open' | 'pay' | 'settle' | 'cancel' | 'expired' | 'closed';
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
}

export interface Stats {
  tabs: number; openTabs: number; paidCalls: number; vouchedSats: string; tip: number;
  onchainTxs?: number; feeSats?: number; perCallTxs?: number; perCallFeeSats?: number;
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
  };
}

export interface DemoInfo { enabled: boolean; agentPub: string; lastCall?: string; lastError?: string; lastErrorAt?: string; healthy: boolean; balanceSats: string }

export class ApiError extends Error {
  status: number;
  body: Record<string, unknown>;
  constructor(status: number, body: Record<string, unknown>, msg: string) { super(msg); this.status = status; this.body = body; }
}

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
  info: () => j<ServerInfo>('/.well-known/agenttab'),
  feed: (since = 0) => j<{ network: string; stats: Stats; events: FeedEvent[] }>(`/feed?since=${since}&limit=60`),
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
  drip: (address: string) => j<{ txid: string; sats: string }>('/faucet/drip', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address }) }),
};
