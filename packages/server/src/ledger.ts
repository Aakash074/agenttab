// Provider-side tab ledger: registers tabs (checked against the chain), verifies one voucher per
// paid request, keeps only the highest voucher per tab, settles on demand, and auto-settles
// before the timeout. Emits feed events (open / pay / settle / expired / closed).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { EventEmitter } from 'node:events';
import type { NetworkProvider } from 'cashscript';
import {
  DUST, buildSettle, hexToBin, binToHex, pubFromPriv, tabContract, verifyVoucher,
  type Network, type Outpoint, type Voucher,
} from '@agenttab/covenant';

export interface TabRecord {
  id: string; // txid:vout
  outpoint: Outpoint;
  ownerPub: string; // hex
  agentPub: string; // hex
  timeout: number; // block height
  budget: string;
  contractAddress: string;
  highest?: { amount: string; sig: string };
  requests: number;
  openedAt: string;
  status: 'open' | 'settled' | 'expired' | 'closed';
  settledTxid?: string;
  settledAmount?: string;
}

export interface FeedEvent {
  id: number;
  at: string;
  type: 'open' | 'pay' | 'settle' | 'expired' | 'closed';
  tab: string;
  txid?: string;
  amount?: string; // pay: cumulative voucher; settle: settled amount; open: budget
  price?: string;
  route?: string;
  auto?: boolean;
  contract?: string;
  agent?: string;
  demo?: boolean;
}

export class PaymentError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 402) { super(message); this.code = code; this.status = status; }
}

export interface LedgerOptions {
  provider: NetworkProvider;
  providerPriv: Uint8Array;
  network: Network;
  /** Refuse new tabs / vouchers, and auto-settle, once a tab is within this many blocks of timeout. */
  safetyBlocks?: number;
  /** Optional JSON file for persistence. */
  file?: string;
  maxEvents?: number;
  /** Refuse to register tabs larger than this (keeps mainnet exposure tiny). */
  maxBudgetSats?: bigint;
}

export const tabId = (o: Outpoint) => `${o.txid}:${o.vout}`;
const HEX33 = /^0[23][0-9a-f]{64}$/i;
/** Smallest voucher worth settling on chain (provider output must stay above dust after the fee). */
export const MIN_SETTLE = DUST + 500n;

export class TabLedger extends EventEmitter {
  tabs = new Map<string, TabRecord>();
  events: FeedEvent[] = [];
  tip = 0;
  /** Live SSE viewers (the demo cron runs faster while someone is watching). */
  viewers = 0;
  /** Set by the demo module so feed events can flag demo-agent activity. */
  demoAgentPub?: string;
  readonly providerPub: Uint8Array;
  readonly network: Network;
  readonly safetyBlocks: number;
  private o: LedgerOptions;
  private nextEventId = 1;
  private settling = new Set<string>();

  constructor(opts: LedgerOptions) {
    super();
    this.o = opts;
    this.network = opts.network;
    this.safetyBlocks = opts.safetyBlocks ?? 6;
    this.providerPub = pubFromPriv(opts.providerPriv);
    if (opts.file && existsSync(opts.file)) {
      const saved = JSON.parse(readFileSync(opts.file, 'utf8'));
      for (const t of saved.tabs ?? []) this.tabs.set(t.id, t);
      this.events = saved.events ?? [];
      this.nextEventId = (this.events.at(-1)?.id ?? 0) + 1;
    }
  }

  private persist() {
    if (!this.o.file) return;
    mkdirSync(dirname(this.o.file), { recursive: true });
    writeFileSync(this.o.file, JSON.stringify({ tabs: [...this.tabs.values()], events: this.events }, null, 1));
  }

  private emitEvent(e: Omit<FeedEvent, 'id' | 'at'>) {
    const rec = this.tabs.get(e.tab);
    const ev: FeedEvent = {
      id: this.nextEventId++, at: new Date().toISOString(), contract: rec?.contractAddress, agent: rec?.agentPub,
      demo: this.demoAgentPub !== undefined && rec?.agentPub === this.demoAgentPub, ...e,
    };
    this.events.push(ev);
    const max = this.o.maxEvents ?? 500;
    if (this.events.length > max) this.events.splice(0, this.events.length - max);
    this.emit('event', ev);
    return ev;
  }

  contractFor(rec: { ownerPub: string; agentPub: string; timeout: number | bigint }) {
    return tabContract({
      ownerPub: hexToBin(rec.ownerPub), agentPub: hexToBin(rec.agentPub),
      providerPub: this.providerPub, timeout: BigInt(rec.timeout),
    }, this.o.provider);
  }

  async refreshTip() {
    this.tip = await this.o.provider.getBlockHeight();
    return this.tip;
  }

  /** Register an opened tab. The utxo must exist at the contract address derived from (owner, agent, us, timeout). */
  async register(input: { txid: string; vout: number; ownerPub: string; agentPub?: string; timeout: string | number }): Promise<TabRecord> {
    if (typeof input?.txid !== 'string' || !/^[0-9a-f]{64}$/i.test(input.txid)) throw new PaymentError('bad_txid', 'txid must be 32-byte hex', 400);
    const outpoint = { txid: input.txid.toLowerCase(), vout: Number(input.vout ?? 0) };
    const id = tabId(outpoint);
    const existing = this.tabs.get(id);
    if (existing) return existing;
    const agentPub = input.agentPub ?? input.ownerPub;
    if (!HEX33.test(input.ownerPub ?? '') || !HEX33.test(agentPub ?? '')) throw new PaymentError('bad_pubkey', 'ownerPub/agentPub must be 33-byte compressed hex', 400);
    const timeout = Number(input.timeout);
    if (!Number.isInteger(timeout) || timeout <= 0 || timeout >= 500_000_000) throw new PaymentError('bad_timeout', 'timeout must be a block height', 400);
    const base = { ownerPub: input.ownerPub.toLowerCase(), agentPub: agentPub.toLowerCase(), timeout };
    const contract = this.contractFor(base);
    const utxo = (await contract.getUtxos()).find((u) => u.txid === outpoint.txid && u.vout === outpoint.vout);
    if (!utxo) throw new PaymentError('tab_not_found', `no utxo ${id} at ${contract.address}`, 400);
    if (utxo.token) throw new PaymentError('tab_has_tokens', 'tab utxo must not carry tokens', 400);
    if (this.o.maxBudgetSats !== undefined && utxo.satoshis > this.o.maxBudgetSats) throw new PaymentError('budget_too_large', `this provider accepts tabs up to ${this.o.maxBudgetSats} sats`, 400);
    if (utxo.satoshis < 2n * DUST + MIN_SETTLE) throw new PaymentError('budget_too_small', `budget must be >= ${2n * DUST + MIN_SETTLE} sats`, 400);
    await this.refreshTip();
    if (this.tip + this.safetyBlocks >= timeout) throw new PaymentError('tab_expiring', `timeout ${timeout} too close to tip ${this.tip}`, 400);
    const rec: TabRecord = {
      id, outpoint, ...base, budget: utxo.satoshis.toString(), contractAddress: contract.address,
      requests: 0, openedAt: new Date().toISOString(), status: 'open',
    };
    this.tabs.set(id, rec);
    this.emitEvent({ type: 'open', tab: id, txid: outpoint.txid, amount: rec.budget });
    this.persist();
    return rec;
  }

  /**
   * Accept a voucher as payment for ONE request costing `price`. The voucher must be exactly
   * `previous + price` (strictly monotonic), which makes every old voucher worthless for replay.
   * Synchronous, so concurrent requests on one tab cannot both pass with the same amount.
   */
  charge(v: { tab: string; amount: string | bigint; sig: string }, price: bigint, route?: string) {
    const rec = this.tabs.get(v.tab);
    if (!rec) throw new PaymentError('unknown_tab', 'register the tab first (POST /tabs)');
    if (rec.status !== 'open') throw new PaymentError('tab_closed', `tab is ${rec.status}${rec.settledTxid ? ` (${rec.settledTxid})` : ''}`);
    if (this.tip + this.safetyBlocks >= rec.timeout) throw new PaymentError('tab_expiring', 'tab is inside the settle window before its timeout; open a new tab');
    let amount: bigint;
    try { amount = BigInt(v.amount); } catch { throw new PaymentError('bad_amount', 'amount must be an integer'); }
    const prev = BigInt(rec.highest?.amount ?? '0');
    const expected = prev + price;
    if (amount <= prev) throw new PaymentError('replayed_voucher', `voucher ${amount} <= highest seen ${prev}`);
    if (amount !== expected) throw new PaymentError('wrong_amount', `expected cumulative ${expected}, got ${amount}`);
    if (amount > BigInt(rec.budget) - DUST) throw new PaymentError('budget_exhausted', 'tab budget exhausted; open a new tab');
    const voucher: Voucher = { outpoint: rec.outpoint, amount, sig: v.sig };
    if (!/^[0-9a-f]{128}$/i.test(v.sig) || !verifyVoucher(hexToBin(rec.agentPub), voucher)) {
      throw new PaymentError('bad_signature', 'voucher signature invalid for this tab');
    }
    rec.highest = { amount: amount.toString(), sig: v.sig.toLowerCase() };
    rec.requests++;
    this.emitEvent({ type: 'pay', tab: rec.id, amount: amount.toString(), price: price.toString(), route });
    this.persist();
    return { tab: rec.id, amount, price, remaining: BigInt(rec.budget) - DUST - amount, requests: rec.requests, timeout: rec.timeout };
  }

  /** Settle a tab on-chain with the highest voucher held. */
  async settle(id: string, auto = false): Promise<string> {
    const rec = this.tabs.get(id);
    if (!rec) throw new PaymentError('unknown_tab', 'unknown tab', 404);
    if (rec.settledTxid) return rec.settledTxid;
    if (rec.status !== 'open') throw new PaymentError('tab_closed', `tab is ${rec.status}`, 409);
    if (!rec.highest) throw new PaymentError('nothing_to_settle', 'no vouchers yet', 400);
    if (BigInt(rec.highest.amount) < MIN_SETTLE) throw new PaymentError('below_min_settle', `need >= ${MIN_SETTLE} sats of vouchers`, 400);
    if (this.settling.has(id)) throw new PaymentError('settling', 'settle already in progress', 409);
    this.settling.add(id);
    try {
      const contract = this.contractFor(rec);
      const tabUtxo = (await contract.getUtxos()).find((u) => u.txid === rec.outpoint.txid && u.vout === rec.outpoint.vout);
      if (!tabUtxo) {
        rec.status = 'closed';
        this.emitEvent({ type: 'closed', tab: id });
        this.persist();
        throw new PaymentError('tab_spent', 'tab utxo already spent (refunded by owner?)', 409);
      }
      const tx = await buildSettle({
        provider: this.o.provider, contract, tabUtxo, providerPriv: this.o.providerPriv,
        ownerPub: hexToBin(rec.ownerPub), network: this.network,
        voucher: { outpoint: rec.outpoint, amount: BigInt(rec.highest.amount), sig: rec.highest.sig },
      }).send();
      rec.settledTxid = tx.txid;
      rec.settledAmount = rec.highest.amount;
      rec.status = 'settled';
      this.emitEvent({ type: 'settle', tab: id, txid: tx.txid, amount: rec.highest.amount, auto });
      this.persist();
      return tx.txid;
    } finally {
      this.settling.delete(id);
    }
  }

  /** Periodic job: refresh tip; auto-settle (or expire) tabs inside the safety window. */
  async tick(): Promise<{ settled: string[]; expired: string[] }> {
    await this.refreshTip();
    const settled: string[] = [], expired: string[] = [];
    for (const rec of this.tabs.values()) {
      if (rec.status !== 'open' || this.tip + this.safetyBlocks < rec.timeout) continue;
      if (rec.highest && BigInt(rec.highest.amount) >= MIN_SETTLE) {
        try { settled.push(await this.settle(rec.id, true)); } catch (e) { console.error('auto-settle failed', rec.id, (e as Error).message); }
      } else {
        rec.status = 'expired';
        expired.push(rec.id);
        this.emitEvent({ type: 'expired', tab: rec.id });
        this.persist();
      }
    }
    return { settled, expired };
  }

  stats() {
    let paidCalls = 0, earned = 0n, open = 0;
    for (const t of this.tabs.values()) {
      paidCalls += t.requests;
      earned += BigInt(t.highest?.amount ?? '0');
      if (t.status === 'open') open++;
    }
    return { tabs: this.tabs.size, openTabs: open, paidCalls, vouchedSats: earned.toString(), tip: this.tip };
  }

  providerPubHex() { return binToHex(this.providerPub); }
}
