// CHIPNET-ONLY drip: sends a few thousand test sats from the server's faucet key to a fresh browser
// test wallet so a visitor can fund a tab in seconds. Refuses to construct on any other network.
import { SignatureTemplate, TransactionBuilder, type NetworkProvider } from 'cashscript';
import { decodeCashAddress } from '@bitauth/libauth';
import { p2pkhAddress, pubFromPriv } from '@agenttab/covenant';
import { json, readBody, type ExtraHandler } from './app.ts';
import { RateLimiter, clientIp } from './ratelimit.ts';

export interface FaucetOptions {
  network: string;
  provider: NetworkProvider;
  faucetPriv: Uint8Array;
  dripSats: bigint;
  trustProxy?: boolean;
  /** Override limits (tests). */
  limits?: { perIp?: [number, number]; perAddress?: [number, number]; global?: [number, number] };
}

export function createFaucet(o: FaucetOptions) {
  if (o.network !== 'chipnet' && o.network !== 'mocknet') throw new Error('faucet drip is chipnet-only');
  const address = p2pkhAddress(pubFromPriv(o.faucetPriv), 'chipnet');
  const l = o.limits ?? {};
  const perIp = new RateLimiter(...(l.perIp ?? [2, 60 * 60_000]));
  const perAddress = new RateLimiter(...(l.perAddress ?? [1, 24 * 60 * 60_000]));
  const global = new RateLimiter(...(l.global ?? [30, 60 * 60_000]));
  let busy: Promise<unknown> = Promise.resolve();

  async function drip(to: string) {
    const run = busy.then(async () => {
      const utxos = (await o.provider.getUtxos(address)).filter((u) => !u.token);
      const b = new TransactionBuilder({ provider: o.provider })
        .addInputs(utxos, new SignatureTemplate(o.faucetPriv).unlockP2PKH())
        .addOutput({ to, amount: o.dripSats });
      b.addBchChangeOutputIfNeeded({ to: address, feeRate: 1 });
      return (await b.send()).txid;
    });
    busy = run.catch(() => {});
    return run;
  }

  const balance = async () => (await o.provider.getUtxos(address)).reduce((s, u) => s + u.satoshis, 0n);

  const handler: ExtraHandler = async (req, res, url) => {
    if (url.pathname === '/faucet' && req.method === 'GET') {
      json(res, 200, { enabled: true, network: 'chipnet', dripSats: o.dripSats.toString(), address, balanceSats: (await balance().catch(() => 0n)).toString() });
      return true;
    }
    if (url.pathname !== '/faucet/drip' || req.method !== 'POST') return false;
    const body = await readBody(req).catch(() => ({}));
    const to = String(body.address ?? '');
    const dec = decodeCashAddress(to);
    if (typeof dec === 'string' || dec.prefix !== 'bchtest' || dec.type !== 'p2pkh') {
      json(res, 400, { error: 'bad_address', message: 'a chipnet P2PKH address (bchtest:q…) is required' });
      return true;
    }
    const wait = perAddress.take(to) || perIp.take(clientIp(req, !!o.trustProxy)) || global.take('all');
    if (wait) { json(res, 429, { error: 'rate_limited', message: 'This wallet or network already received test coins recently.', retryInMs: wait }); return true; }
    try {
      json(res, 200, { txid: await drip(to), sats: o.dripSats.toString() });
    } catch (e) {
      json(res, 503, { error: 'faucet_failed', message: (e as Error).message });
    }
    return true;
  };

  return { address, handler, drip, balance };
}
