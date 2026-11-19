// Faucet balance / coin selection (primary + non-relaying mirror) and quota refunds.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { MockNetworkProvider, randomUtxo, type SpendableUtxo as Utxo } from 'cashscript';
import { binToHex, encodeTransaction, generatePrivateKey, hashTransaction, hexToBin } from '@bitauth/libauth';
import { p2pkhAddress, pubFromPriv } from '@agenttab/covenant';
import { TabLedger } from '../src/ledger.ts';
import { createApp } from '../src/app.ts';
import { createFaucet, faucetCoins, relayTx, selectCoins } from '../src/faucet.ts';
import { RateLimiter, takeAll } from '../src/ratelimit.ts';

/** A minimal tx spending `parents` (txids), so relayTx can walk its inputs. */
function fakeTx(parents: string[], tag: number) {
  const raw = encodeTransaction({
    version: 2, locktime: tag,
    inputs: parents.map((p) => ({ outpointTransactionHash: hexToBin(p), outpointIndex: 0, sequenceNumber: 0, unlockingBytecode: new Uint8Array() })),
    outputs: [{ lockingBytecode: Uint8Array.of(0x51), valueSatoshis: 1000n }],
  });
  return { raw: binToHex(raw), txid: hashTransaction(raw) };
}

/** In-memory electrum server: raw txs it knows, the UTXOs it reports, and what was broadcast to it. */
function fakeServer(txs: Record<string, string> = {}, utxos: Utxo[] = [], refuse = false) {
  const sent: string[] = [];
  return {
    txs, sent,
    getUtxos: async () => utxos,
    getRawTransaction: async (id: string) => { if (!txs[id]) throw new Error('No such mempool or blockchain transaction'); return txs[id]; },
    sendRawTransaction: async (raw: string) => {
      if (refuse) throw new Error('missing inputs');
      const id = hashTransaction(hexToBin(raw));
      sent.push(id); txs[id] = raw; return id;
    },
  };
}
const coin = (txid: string, satoshis: bigint): Utxo => ({ txid, vout: 0, satoshis, lockingBytecode: '76a914' });

describe('faucet coins (root cause: public-faucet top-ups visible only on the non-relaying mirror)', () => {
  const confirmed = 'aa'.repeat(32);
  const a = fakeTx([confirmed], 1), b = fakeTx([a.txid], 2), c = fakeTx([b.txid], 3);

  test('relayTx sends missing unconfirmed ancestors parents-first', async () => {
    const mirror = fakeServer({ [a.txid]: a.raw, [b.txid]: b.raw, [c.txid]: c.raw });
    const primary = fakeServer({ [confirmed]: '00' });
    assert.equal(await relayTx(mirror, primary, c.txid), 3);
    assert.deepEqual(primary.sent, [a.txid, b.txid, c.txid]);
    assert.equal(await relayTx(mirror, primary, c.txid), 0, 'nothing to do once the primary knows it');
  });

  test('balance counts mirror-only coins after relaying them (23,029 -> 5,023,029 like chipnet on 2026-11-19)', async () => {
    const change = coin('bb'.repeat(32), 23_029n);
    const topUps = [coin(b.txid, 500_000n), coin(c.txid, 500_000n)];
    const mirror = fakeServer({ [a.txid]: a.raw, [b.txid]: b.raw, [c.txid]: c.raw }, [change, ...topUps]);
    const primary = fakeServer({ [confirmed]: '00', [change.txid]: '00' }, [change]);
    const r = await faucetCoins(primary, 'x', mirror);
    assert.equal(r.sats, 1_023_029n);
    assert.equal(r.pendingSats, 0n);
    assert.equal(r.utxos[0].satoshis, 500_000n, 'largest first');
    assert.deepEqual(primary.sent, [a.txid, b.txid, c.txid]);
  });

  test('coins the primary refuses stay pending, not spendable', async () => {
    const mirror = fakeServer({ [a.txid]: a.raw }, [coin(a.txid, 500_000n)]);
    const primary = fakeServer({}, [coin('bb'.repeat(32), 23_029n)], true);
    const r = await faucetCoins(primary, 'x', mirror);
    assert.equal(r.sats, 23_029n);
    assert.equal(r.pendingSats, 500_000n);
  });

  test('selectCoins needs the drip plus fee room', () => {
    assert.equal(selectCoins([coin('bb'.repeat(32), 23_029n)], 25_000n), null);
    assert.equal(selectCoins([coin('cc'.repeat(32), 500_000n), coin('bb'.repeat(32), 23_029n)], 25_000n)!.length, 1);
  });
});

describe('rate-limit refunds', () => {
  test('refund gives back the last hit', () => {
    const l = new RateLimiter(1, 60_000);
    assert.equal(l.take('k'), 0);
    assert.ok(l.take('k') > 0);
    l.refund('k');
    assert.equal(l.take('k'), 0);
  });
  test('takeAll refunds the limits it already took when a later one refuses', () => {
    const addr = new RateLimiter(3, 60_000), ip = new RateLimiter(1, 60_000);
    ip.take('ip');
    assert.ok(takeAll([[addr, 'a'], [ip, 'ip']]).wait > 0);
    for (let i = 0; i < 3; i++) assert.equal(addr.take('a'), 0, 'address quota untouched by the IP refusal');
  });
});

describe('faucet HTTP: empty faucet and failed drips never burn quota', () => {
  const servers: { close(): void }[] = [];
  after(() => servers.forEach((s) => s.close()));
  async function setup(fail = { send: false }) {
    const net = new MockNetworkProvider();
    const send = net.sendRawTransaction.bind(net);
    net.sendRawTransaction = async (hex: string) => { if (fail.send) throw new Error('node refused'); return send(hex); };
    const faucetPriv = generatePrivateKey();
    const faucet = createFaucet({ network: 'mocknet', provider: net, faucetPriv, dripSats: 25_000n, limits: { perAddress: [1, 60_000], perIp: [1, 60_000] } });
    const ledger = new TabLedger({ provider: net, providerPriv: generatePrivateKey(), network: 'mocknet' });
    const app = createApp({ ledger, network: 'mocknet', extra: [faucet.handler], routes: [] });
    await new Promise<void>((r) => app.listen(0, r));
    servers.push(app);
    const base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
    const to = p2pkhAddress(pubFromPriv(generatePrivateKey()), 'chipnet');
    const drip = () => fetch(`${base}/faucet/drip`, { method: 'POST', body: JSON.stringify({ address: to }) });
    return { net, faucet, base, drip };
  }

  test('empty faucet: 503 faucet_empty (non-retryable) before any quota is taken', async () => {
    const { net, faucet, drip, base } = await setup();
    net.addUtxo(faucet.address, randomUtxo({ satoshis: 23_029n }));
    for (let i = 0; i < 3; i++) {
      const r = await drip();
      assert.equal(r.status, 503);
      const b = await r.json();
      assert.equal(b.error, 'faucet_empty');
      assert.equal(b.retryable, false);
    }
    const info = await (await fetch(`${base}/faucet`)).json();
    assert.equal(info.balanceSats, '23029');
    assert.equal(info.topUpBelowSats, '100000', 'top-up threshold is at least 4 drips');
    net.addUtxo(faucet.address, randomUtxo({ satoshis: 500_000n }));
    assert.equal((await drip()).status, 200, 'quota (1/address, 1/IP) still available after 3 empty refusals');
  });

  test('a drip that fails to broadcast refunds the per-address and per-IP counts', async () => {
    const fail = { send: true };
    const { net, faucet, drip } = await setup(fail);
    net.addUtxo(faucet.address, randomUtxo({ satoshis: 500_000n }));
    const r = await drip();
    assert.equal(r.status, 503);
    assert.equal((await r.json()).error, 'faucet_failed');
    fail.send = false;
    assert.equal((await drip()).status, 200);
    assert.equal((await drip()).status, 409, 'funded now');
  });

  test('top-up threshold never below 4 drips; 0 still turns it off', () => {
    const net = new MockNetworkProvider();
    const k = generatePrivateKey();
    assert.equal(createFaucet({ network: 'mocknet', provider: net, faucetPriv: k, dripSats: 25_000n, topUpBelowSats: 6_000n }).topUpBelowSats, 100_000n);
    assert.equal(createFaucet({ network: 'mocknet', provider: net, faucetPriv: k, dripSats: 25_000n, topUpBelowSats: 300_000n }).topUpBelowSats, 300_000n);
    assert.equal(createFaucet({ network: 'mocknet', provider: net, faucetPriv: k, dripSats: 25_000n, topUpBelowSats: 0n }).topUpBelowSats, 0n);
  });
});
