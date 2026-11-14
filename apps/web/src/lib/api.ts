import { SERVERS, type Net } from '../config';

export interface FeedEvent {
  id: number;
  at: string;
  type: 'open' | 'pay' | 'settle' | 'expired' | 'closed';
  tab: string;
  txid?: string;
  amount?: string;
  price?: string;
  route?: string;
  auto?: boolean;
  contract?: string;
  agent?: string;
  demo?: boolean;
}

export interface Stats { tabs: number; openTabs: number; paidCalls: number; vouchedSats: string; tip: number }

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
  status: 'open' | 'settled' | 'expired' | 'closed';
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
  demoCall: (tab?: string) => j<DemoCall>('/demo/call', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(tab ? { tab } : {}) }),
  demoInfo: () => j<DemoInfo>('/demo'),
  closeTab: (id: string) => j<{ txid: string; settledSats: string; returnedSats: string }>(`/tabs/${id}/close`, { method: 'POST' }),
  drip: (address: string) => j<{ txid: string; sats: string }>('/faucet/drip', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address }) }),
};
