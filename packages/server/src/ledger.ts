// Provider-side tab ledger: registers tabs (checked against the chain), verifies one voucher per
// paid request, keeps only the highest voucher per tab, and settles on demand.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { NetworkProvider } from 'cashscript';
import {
  DUST, buildSettle, hexToBin, binToHex, pubFromPriv, tabContract, verifyVoucher,
  type Network, type Outpoint, type Voucher,
} from '@agenttab/covenant';

export interface TabRecord {
  id: string; // txid:vout
  outpoint: Outpoint;
  ownerPub: string; // hex
  timeout: string; // bigint as string
  budget: string;
  contractAddress: string;
  highest?: { amount: string; sig: string };
  requests: number;
  settledTxid?: string;
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
  /** Refuse vouchers once the tab is within this many blocks of its (height) timeout. */
  safetyBlocks?: number;
  /** Optional JSON file for persistence. */
  file?: string;
}

export const tabId = (o: Outpoint) => `${o.txid}:${o.vout}`;

export class TabLedger {
  tabs = new Map<string, TabRecord>();
  readonly providerPub: Uint8Array;
  private o: Required<Omit<LedgerOptions, 'file'>> & { file?: string };

  constructor(opts: LedgerOptions) {
    this.o = { safetyBlocks: 6, ...opts };
    this.providerPub = pubFromPriv(opts.providerPriv);
    if (opts.file && existsSync(opts.file)) {
      for (const t of JSON.parse(readFileSync(opts.file, 'utf8')) as TabRecord[]) this.tabs.set(t.id, t);
    }
  }

  private persist() {
    if (!this.o.file) return;
    mkdirSync(dirname(this.o.file), { recursive: true });
    writeFileSync(this.o.file, JSON.stringify([...this.tabs.values()], null, 2));
  }

  contractFor(ownerPub: string, timeout: bigint) {
    return tabContract({ ownerPub: hexToBin(ownerPub), providerPub: this.providerPub, timeout }, this.o.provider);
  }

  /** Register an opened tab. The utxo must exist at the contract address derived from (owner, us, timeout). */
  async register(input: { txid: string; vout: number; ownerPub: string; timeout: string | number | bigint }): Promise<TabRecord> {
    const outpoint = { txid: input.txid.toLowerCase(), vout: Number(input.vout) };
    const id = tabId(outpoint);
    const existing = this.tabs.get(id);
    if (existing) return existing;
    if (!/^[0-9a-f]{66}$/i.test(input.ownerPub)) throw new PaymentError('bad_pubkey', 'ownerPub must be 33-byte hex', 400);
    const timeout = BigInt(input.timeout);
    const contract = this.contractFor(input.ownerPub, timeout);
    const utxo = (await contract.getUtxos()).find((u) => u.txid === outpoint.txid && u.vout === outpoint.vout);
    if (!utxo) throw new PaymentError('tab_not_found', `no utxo ${id} at ${contract.address}`, 400);
    if (utxo.token) throw new PaymentError('tab_has_tokens', 'tab utxo must not carry tokens', 400);
    if (timeout < 500_000_000n) {
      const h = await this.o.provider.getBlockHeight();
      if (BigInt(h + this.o.safetyBlocks) >= timeout) throw new PaymentError('tab_expiring', 'tab timeout too close', 400);
    }
    const rec: TabRecord = {
      id, outpoint, ownerPub: input.ownerPub.toLowerCase(), timeout: timeout.toString(),
      budget: utxo.satoshis.toString(), contractAddress: contract.address, requests: 0,
    };
    this.tabs.set(id, rec);
    this.persist();
    return rec;
  }

  /**
   * Accept a voucher as payment for ONE request costing `price`. The voucher must be exactly
   * `previous + price` (strictly monotonic), which makes every old voucher worthless for replay.
   * Synchronous after lookup, so concurrent requests on one tab cannot both pass with the same amount.
   */
  charge(v: { tab: string; amount: string | bigint; sig: string }, price: bigint) {
    const rec = this.tabs.get(v.tab);
    if (!rec) throw new PaymentError('unknown_tab', 'register the tab first (POST /tabs)');
    if (rec.settledTxid) throw new PaymentError('tab_closed', `tab settled in ${rec.settledTxid}`);
    const amount = BigInt(v.amount);
    const prev = BigInt(rec.highest?.amount ?? '0');
    const expected = prev + price;
    if (amount <= prev) throw new PaymentError('replayed_voucher', `voucher ${amount} <= highest seen ${prev}`);
    if (amount !== expected) throw new PaymentError('wrong_amount', `expected cumulative ${expected}, got ${amount}`);
    if (amount > BigInt(rec.budget) - DUST) throw new PaymentError('budget_exhausted', 'tab budget exhausted; open a new tab');
    const voucher: Voucher = { outpoint: rec.outpoint, amount, sig: v.sig };
    if (!/^[0-9a-f]{128}$/i.test(v.sig) || !verifyVoucher(hexToBin(rec.ownerPub), voucher)) {
      throw new PaymentError('bad_signature', 'voucher signature invalid for this tab');
    }
    rec.highest = { amount: amount.toString(), sig: v.sig.toLowerCase() };
    rec.requests++;
    this.persist();
    return { tab: rec.id, amount, remaining: BigInt(rec.budget) - DUST - amount, requests: rec.requests };
  }

  /** Settle a tab on-chain with the highest voucher held. */
  async settle(id: string): Promise<string> {
    const rec = this.tabs.get(id);
    if (!rec) throw new PaymentError('unknown_tab', 'unknown tab', 404);
    if (rec.settledTxid) return rec.settledTxid;
    if (!rec.highest) throw new PaymentError('nothing_to_settle', 'no vouchers yet', 400);
    const contract = this.contractFor(rec.ownerPub, BigInt(rec.timeout));
    const tabUtxo = (await contract.getUtxos()).find((u) => u.txid === rec.outpoint.txid && u.vout === rec.outpoint.vout);
    if (!tabUtxo) throw new PaymentError('tab_spent', 'tab utxo already spent (refunded?)', 409);
    const tx = await buildSettle({
      provider: this.o.provider, contract, tabUtxo, providerPriv: this.o.providerPriv,
      ownerPub: hexToBin(rec.ownerPub), network: this.o.network,
      voucher: { outpoint: rec.outpoint, amount: BigInt(rec.highest.amount), sig: rec.highest.sig },
    }).send();
    rec.settledTxid = tx.txid;
    this.persist();
    return tx.txid;
  }

  providerPubHex() { return binToHex(this.providerPub); }
}
