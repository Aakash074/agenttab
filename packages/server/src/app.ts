// Minimal x402-style paywall: 402 + `bch-credit` terms, one cumulative voucher per paid request.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { artifact, binToHex } from '@agenttab/covenant';
import { PaymentError, type TabLedger } from './ledger.ts';

export interface PaidRoute {
  path: string;
  price: bigint; // sats per request
  description: string;
  handler: (url: URL) => Promise<unknown> | unknown;
}

export type ExtraHandler = (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<boolean> | boolean;

export interface AppOptions {
  ledger: TabLedger;
  network: 'chipnet' | 'mainnet' | 'mocknet';
  routes: PaidRoute[];
  adminToken?: string;
  /** Extra routes (demo agent, faucet drip…). Return true when handled. */
  extra?: ExtraHandler[];
  /** Advertised in /.well-known/agenttab. */
  features?: Record<string, unknown>;
  /** Optional BCH/USD spot for display (free, cached). */
  bchUsd?: () => Promise<number | undefined>;
}

export const CONTRACT_SOURCE = readFileSync(new URL('../../covenant/contracts/AgentTab.cash', import.meta.url), 'utf8');
export const ARTIFACT_HASH = binToHex(createHash('sha256').update(artifact.debug?.bytecode ?? artifact.bytecode).digest());

export const json = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
  res.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type, x-payment, authorization',
    'access-control-expose-headers': 'x-payment-response',
    ...headers,
  });
  res.end(JSON.stringify(body, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
};

export async function readBody(req: IncomingMessage): Promise<any> {
  let raw = '';
  for await (const c of req) { raw += c; if (raw.length > 16_384) throw new PaymentError('too_large', 'body too large', 413); }
  try { return raw ? JSON.parse(raw) : {}; } catch { throw new PaymentError('bad_json', 'invalid JSON', 400); }
}

export function paymentRequirements(o: AppOptions, route: PaidRoute, resource: string) {
  return {
    x402Version: 1,
    error: 'X-PAYMENT header is required',
    accepts: [{
      scheme: 'bch-credit',
      network: `bch-${o.network}`,
      maxAmountRequired: route.price.toString(),
      resource,
      description: route.description,
      mimeType: 'application/json',
      payTo: o.ledger.providerPubHex(),
      asset: 'BCH',
      maxTimeoutSeconds: 30,
      extra: {
        contract: 'AgentTab',
        artifactHash: ARTIFACT_HASH,
        voucher: 'schnorr datasig(owner, sha256("AGENTTAB" || outpointTxHashLE || voutLE32 || cumulativeAmountLE64))',
        openTab: '/tabs',
        minTimeoutBlocks: o.ledger.safetyBlocks + 1,
        voucherSigner: 'agentPub (register with POST /tabs {txid,vout,ownerPub,agentPub,timeout})',
      },
    }],
  };
}

/** Parses `X-PAYMENT: base64(json{ payload: { tab, amount, sig } })`. */
export function parsePaymentHeader(h: string | undefined) {
  if (!h) return undefined;
  try {
    const obj = JSON.parse(Buffer.from(h, 'base64').toString('utf8'));
    const p = obj.payload ?? obj;
    if (typeof p.tab !== 'string' || typeof p.sig !== 'string' || p.amount === undefined) throw 0;
    if (obj.scheme && obj.scheme !== 'bch-credit') throw 0;
    return { tab: p.tab as string, amount: String(p.amount), sig: p.sig as string };
  } catch {
    throw new PaymentError('bad_payment_header', 'X-PAYMENT must be base64 JSON {scheme:"bch-credit",payload:{tab,amount,sig}}');
  }
}

export function encodePaymentHeader(network: string, payload: { tab: string; amount: bigint | string; sig: string }) {
  return Buffer.from(JSON.stringify({
    x402Version: 1, scheme: 'bch-credit', network: `bch-${network}`,
    payload: { ...payload, amount: payload.amount.toString() },
  })).toString('base64');
}

export function createApp(o: AppOptions) {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (req.method === 'OPTIONS') return json(res, 204, {});
      if (req.method === 'GET' && url.pathname === '/.well-known/agenttab') {
        return json(res, 200, {
          providerPub: o.ledger.providerPubHex(), network: o.network, artifactHash: ARTIFACT_HASH,
          tip: o.ledger.tip, safetyBlocks: o.ledger.safetyBlocks, features: o.features ?? {},
          bchUsd: await o.bchUsd?.().catch(() => undefined),
          routes: o.routes.map((r) => ({ path: r.path, price: r.price, description: r.description })),
        });
      }
      if (req.method === 'GET' && url.pathname === '/contract') {
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'access-control-allow-origin': '*' });
        res.end(CONTRACT_SOURCE);
        return;
      }
      for (const h of o.extra ?? []) if (await h(req, res, url)) return;
      if (req.method === 'GET' && url.pathname === '/feed') {
        const since = Number(url.searchParams.get('since') ?? 0);
        const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), 200);
        const events = o.ledger.events.filter((e) => e.id > since).slice(-limit).reverse();
        return json(res, 200, { network: o.network, stats: o.ledger.stats(), events });
      }
      if (req.method === 'GET' && url.pathname === '/feed/stream') {
        res.writeHead(200, {
          'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive',
          'access-control-allow-origin': '*',
        });
        const send = (e: unknown) => res.write(`data: ${JSON.stringify(e)}\n\n`);
        for (const e of o.ledger.events.slice(-20)) send(e);
        const ping = setInterval(() => res.write(': ping\n\n'), 15_000);
        o.ledger.on('event', send);
        req.on('close', () => { clearInterval(ping); o.ledger.off('event', send); });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/tabs') {
        const agent = url.searchParams.get('agent')?.toLowerCase();
        const owner = url.searchParams.get('owner')?.toLowerCase();
        const list = [...o.ledger.tabs.values()].filter((t) => (!agent || t.agentPub === agent) && (!owner || t.ownerPub === owner));
        return json(res, 200, { tip: o.ledger.tip, tabs: list.reverse() });
      }
      if (req.method === 'POST' && url.pathname === '/tabs') {
        return json(res, 201, await o.ledger.register(await readBody(req)));
      }
      const m = url.pathname.match(/^\/tabs\/([0-9a-f]{64}:\d+)(\/settle)?$/i);
      if (m && req.method === 'GET' && !m[2]) {
        const t = o.ledger.tabs.get(m[1]);
        return t ? json(res, 200, { ...t, tip: o.ledger.tip }) : json(res, 404, { error: 'unknown_tab' });
      }
      if (m && req.method === 'POST' && m[2]) {
        if (o.adminToken && req.headers.authorization !== `Bearer ${o.adminToken}`) return json(res, 401, { error: 'unauthorized' });
        return json(res, 200, { txid: await o.ledger.settle(m[1]) });
      }
      const route = o.routes.find((r) => r.path === url.pathname);
      if (route && req.method === 'GET') {
        const pay = parsePaymentHeader(req.headers['x-payment'] as string | undefined);
        if (!pay) return json(res, 402, paymentRequirements(o, route, url.pathname));
        const receipt = o.ledger.charge(pay, route.price, route.path);
        const body = await route.handler(url);
        return json(res, 200, body, {
          'x-payment-response': Buffer.from(JSON.stringify({ success: true, scheme: 'bch-credit', ...receipt },
            (_k, v) => (typeof v === 'bigint' ? v.toString() : v))).toString('base64'),
        });
      }
      return json(res, 404, { error: 'not_found' });
    } catch (e) {
      if (e instanceof PaymentError) {
        const route = o.routes.find((r) => r.path === url.pathname);
        const extra = e.status === 402 && route ? paymentRequirements(o, route, url.pathname) : {};
        return json(res, e.status, { ...extra, error: e.code, message: e.message });
      }
      console.error(e);
      return json(res, 500, { error: 'internal', message: (e as Error).message });
    }
  });
}
