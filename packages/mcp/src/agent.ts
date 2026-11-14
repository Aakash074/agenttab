// Agent-side AgentTab client: pays through HTTP 402 `bch-credit` challenges with cumulative vouchers.
// Uses a tab a human funded for this agent (found via the provider's /tabs?agent=), or opens one from
// the agent's own funds, always under hard budget caps.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { NetworkProvider } from 'cashscript';
import {
  DUST, binToHex, buildOpen, buildRefund, hexToBin, p2pkhAddress, pubFromPriv, signVoucher, tabContract,
} from '@agenttab/covenant';

export interface AgentConfig {
  agentPriv: Uint8Array;
  network: 'chipnet' | 'mainnet';
  provider: NetworkProvider;
  /** Budget for tabs the agent opens from its own funds. */
  maxBudgetSats: bigint;
  /** Refuse any single call priced above this. */
  maxPriceSats: bigint;
  /** Refuse to spend more than this in total across all tabs in this process' state file. */
  maxTotalSats: bigint;
  /** Blocks until refund for tabs the agent opens itself. */
  tabBlocks: number;
  stateFile?: string;
  fetchImpl?: typeof fetch;
  /** false = never open tabs from the agent's own funds (only spend tabs someone funded for it). */
  allowOpen?: boolean;
}

export interface LocalTab {
  id: string; // txid:vout
  origin: string;
  providerPub: string;
  ownerPub: string;
  timeout: number;
  budget: string;
  signed: string; // highest cumulative amount this agent has signed
  fundedBy: 'agent' | 'owner';
  closed?: { action: string; txid: string };
}

interface Terms {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  payTo: string;
  resource: string;
  extra?: { minTimeoutBlocks?: number; openTab?: string };
}

/** The tab the caller asked for is closed (settled, waived, refunded or expiring). */
export class TabClosedError extends Error {
  tab: string;
  constructor(tab: string, reason: string) { super(`That tab is closed (${reason}).`); this.tab = tab; }
}

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64');
const unb64 = (s: string) => JSON.parse(Buffer.from(s, 'base64').toString('utf8'));

export class AgentTabClient {
  readonly agentPub: Uint8Array;
  readonly agentPubHex: string;
  readonly address: string;
  tabs = new Map<string, LocalTab>();
  private cfg: AgentConfig;
  private fetch: typeof fetch;
  private lock: Promise<unknown> = Promise.resolve();

  constructor(cfg: AgentConfig) {
    this.cfg = cfg;
    this.fetch = cfg.fetchImpl ?? fetch;
    this.agentPub = pubFromPriv(cfg.agentPriv);
    this.agentPubHex = binToHex(this.agentPub);
    this.address = p2pkhAddress(this.agentPub, cfg.network);
    if (cfg.stateFile && existsSync(cfg.stateFile)) {
      for (const t of JSON.parse(readFileSync(cfg.stateFile, 'utf8')).tabs ?? []) this.tabs.set(t.id, t);
    }
  }

  private save() {
    if (!this.cfg.stateFile) return;
    mkdirSync(dirname(this.cfg.stateFile), { recursive: true });
    writeFileSync(this.cfg.stateFile, JSON.stringify({ tabs: [...this.tabs.values()] }, null, 1));
  }

  totalSigned() { return [...this.tabs.values()].reduce((s, t) => s + BigInt(t.signed), 0n); }

  async balance() { return (await this.cfg.provider.getUtxos(this.address)).filter((u) => !u.token).reduce((s, u) => s + u.satoshis, 0n); }

  /** Serialize payments so two concurrent calls never sign the same cumulative amount. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(fn, fn);
    this.lock = run.catch(() => {});
    return run;
  }

  /** Ask the provider whether a tab someone else funded is still open; mark it closed locally if not. */
  private async stillOpen(t: LocalTab): Promise<boolean> {
    if (t.fundedBy === 'agent') return true; // our own tabs only close when we close them
    try {
      const r = await this.fetch(`${t.origin}/tabs/${t.id}`);
      if (!r.ok) return true; // provider unreachable/unknown: let the payment attempt decide
      const st = (await r.json()) as { status?: string; settledTxid?: string };
      if (st.status && st.status !== 'open') {
        t.closed = { action: st.status, txid: st.settledTxid ?? '' };
        this.save();
        return false;
      }
    } catch { /* offline */ }
    return true;
  }

  private async pickTab(origin: string, terms: Terms, price: bigint, preferTab?: string, ownTabsOnly = false): Promise<LocalTab> {
    const tip = await this.cfg.provider.getBlockHeight();
    const margin = (terms.extra?.minTimeoutBlocks ?? 7) + 1;
    const usable = (t: LocalTab) => !t.closed && t.origin === origin && t.providerPub === terms.payTo && t.timeout > tip + margin
      && BigInt(t.signed) + price <= BigInt(t.budget) - DUST && (!ownTabsOnly || t.fundedBy === 'agent');
    const preferred = preferTab ? this.tabs.get(preferTab) : undefined;
    if (preferred && usable(preferred) && await this.stillOpen(preferred)) return preferred;
    if (!preferTab) {
      for (const t of [...this.tabs.values()].filter(usable)) if (await this.stillOpen(t)) return t;
    }
    if (ownTabsOnly) return this.openOwnTab(origin, terms, tip);

    // A tab a human funded for this agent at this provider?
    const r = await this.fetch(`${origin}/tabs?agent=${this.agentPubHex}`);
    if (r.ok) {
      const { tabs } = await r.json() as { tabs: { id: string; status: string; ownerPub: string; timeout: number; budget: string; highest?: { amount: string } }[] };
      tabs.sort((a, b) => Number(b.id === preferTab) - Number(a.id === preferTab));
      for (const s of tabs) {
        if (s.status !== 'open' || this.tabs.has(s.id)) continue;
        const t: LocalTab = {
          id: s.id, origin, providerPub: terms.payTo, ownerPub: s.ownerPub, timeout: s.timeout, budget: s.budget,
          signed: s.highest?.amount ?? '0', fundedBy: s.ownerPub === this.agentPubHex ? 'agent' : 'owner',
        };
        // Verify the tab really exists on chain at the expected covenant before trusting it.
        const c = tabContract({ ownerPub: hexToBin(t.ownerPub), agentPub: this.agentPub, providerPub: hexToBin(t.providerPub), timeout: BigInt(t.timeout) }, this.cfg.provider);
        const [txid, vout] = t.id.split(':');
        const utxo = (await c.getUtxos()).find((u) => u.txid === txid && u.vout === Number(vout));
        if (!utxo || utxo.satoshis.toString() !== t.budget) continue;
        this.tabs.set(t.id, t);
        this.save();
        if (usable(t) && (!preferTab || t.id === preferTab)) return t;
      }
    }
    // The caller asked for a specific tab and it is not usable: say so instead of silently paying elsewhere.
    if (preferTab) throw new TabClosedError(preferTab, this.tabs.get(preferTab)?.closed?.action ?? 'not open or out of budget');
    return this.openOwnTab(origin, terms, tip);
  }

  private async openOwnTab(origin: string, terms: Terms, tip: number): Promise<LocalTab> {
    if (this.cfg.allowOpen === false) throw new Error('no funded tab available for this agent (fund one first)');
    const budget = this.cfg.maxBudgetSats;
    const timeout = tip + Math.max(this.cfg.tabBlocks, (terms.extra?.minTimeoutBlocks ?? 7) + 6);
    const contract = tabContract({ ownerPub: this.agentPub, agentPub: this.agentPub, providerPub: hexToBin(terms.payTo), timeout: BigInt(timeout) }, this.cfg.provider);
    const fundingUtxos = (await this.cfg.provider.getUtxos(this.address)).filter((u) => !u.token);
    const tx = await buildOpen({ provider: this.cfg.provider, contract, payerPriv: this.cfg.agentPriv, fundingUtxos, budget, changeAddress: this.address }).send();
    const t: LocalTab = {
      id: `${tx.txid}:0`, origin, providerPub: terms.payTo, ownerPub: this.agentPubHex, timeout, budget: budget.toString(), signed: '0', fundedBy: 'agent',
    };
    this.tabs.set(t.id, t);
    this.save();
    let lastErr = '';
    for (let i = 0; i < 6; i++) {
      const r = await this.fetch(`${origin}${terms.extra?.openTab ?? '/tabs'}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ txid: tx.txid, vout: 0, ownerPub: this.agentPubHex, agentPub: this.agentPubHex, timeout }),
      });
      if (r.ok) return t;
      lastErr = await r.text();
      await new Promise((res) => setTimeout(res, 1500));
    }
    throw new Error(`opened tab ${t.id} but provider refused registration: ${lastErr}`);
  }

  /** GET/POST a URL; if it answers 402 bch-credit, pay one call from a tab and retry. */
  fetchPaid(url: string, init: RequestInit = {}, maxPrice = this.cfg.maxPriceSats, opts: { preferTab?: string; ownTabsOnly?: boolean } = {}) {
    return this.exclusive(async () => {
      try { return await this.payOnce(url, init, maxPrice, opts); } catch (e) {
        // A tab closed under us (e.g. its owner pressed "Close tab now"): it is now marked closed, try once more.
        if (e instanceof TabClosedError && !opts.preferTab) return this.payOnce(url, init, maxPrice, opts);
        throw e;
      }
    });
  }

  private async payOnce(url: string, init: RequestInit, maxPrice: bigint, opts: { preferTab?: string; ownTabsOnly?: boolean }) {
    {
      const origin = new URL(url).origin;
      const first = await this.fetch(url, init);
      if (first.status !== 402) return { status: first.status, paid: false as const, body: await first.text() };
      const challenge = await first.json();
      const terms: Terms | undefined = challenge.accepts?.find((a: Terms) => a.scheme === 'bch-credit' && a.network === `bch-${this.cfg.network}`);
      if (!terms) throw new Error(`402 without a bch-credit/${this.cfg.network} option: ${JSON.stringify(challenge).slice(0, 300)}`);
      const price = BigInt(terms.maxAmountRequired);
      const cap = maxPrice < this.cfg.maxPriceSats ? maxPrice : this.cfg.maxPriceSats;
      if (price > cap) throw new Error(`price ${price} sats exceeds cap ${cap}`);
      if (this.totalSigned() + price > this.cfg.maxTotalSats) throw new Error(`total spend cap ${this.cfg.maxTotalSats} sats reached`);

      const tab = await this.pickTab(origin, terms, price, opts.preferTab, opts.ownTabsOnly);
      const [txid, vout] = tab.id.split(':');
      const amount = BigInt(tab.signed) + price;
      const v = signVoucher(this.cfg.agentPriv, { txid, vout: Number(vout) }, amount);
      // Record before sending: the provider may keep a voucher even if the response is lost.
      tab.signed = amount.toString();
      this.save();
      const headers = new Headers(init.headers);
      headers.set('x-payment', b64({ x402Version: 1, scheme: 'bch-credit', network: terms.network, payload: { tab: tab.id, amount: amount.toString(), sig: v.sig } }));
      const paid = await this.fetch(url, { ...init, headers });
      const receiptHeader = paid.headers.get('x-payment-response');
      const body = await paid.text();
      if (paid.status === 402) {
        const err = JSON.parse(body);
        if (err.error === 'tab_closed' || err.error === 'tab_expiring') {
          tab.signed = (amount - price).toString();
          tab.closed = { action: err.error, txid: '' };
          this.save();
          throw new TabClosedError(tab.id, err.error);
        }
        if (err.error === 'wrong_amount' || err.error === 'replayed_voucher') {
          // Our local count disagrees with the provider; never sign above what we already signed + price.
          throw new Error(`provider rejected voucher (${err.error}: ${err.message}); tab ${tab.id}`);
        }
        throw new Error(`payment refused: ${err.error} ${err.message ?? ''}`);
      }
      return {
        status: paid.status, paid: true as const, body,
        receipt: receiptHeader ? unb64(receiptHeader) : undefined,
        tab: tab.id, priceSats: price.toString(), cumulativeSats: amount.toString(),
        remainingSats: (BigInt(tab.budget) - DUST - amount).toString(),
      };
    }
  }

  async status(id?: string) {
    const tip = await this.cfg.provider.getBlockHeight();
    const list = id ? [this.tabs.get(id)].filter(Boolean) as LocalTab[] : [...this.tabs.values()];
    return Promise.all(list.map(async (t) => {
      let server: unknown;
      try { const r = await this.fetch(`${t.origin}/tabs/${t.id}`); server = r.ok ? await r.json() : undefined; } catch { /* offline */ }
      const s = server as { status?: string; settledTxid?: string } | undefined;
      return {
        tab: t.id, provider: t.origin, fundedBy: t.fundedBy, budgetSats: t.budget, signedSats: t.signed,
        remainingSats: (BigInt(t.budget) - DUST - BigInt(t.signed)).toString(), timeout: t.timeout, tip,
        blocksUntilRefund: Math.max(0, t.timeout - tip), providerStatus: s?.status, settledTxid: s?.settledTxid,
      };
    }));
  }

  /** Close a tab: ask the provider to settle now; if the timeout passed and the agent owns the tab, refund instead. */
  async close(id: string) {
    const t = this.tabs.get(id);
    if (!t) throw new Error(`unknown tab ${id}`);
    const tip = await this.cfg.provider.getBlockHeight();
    if (tip >= t.timeout && t.fundedBy === 'agent') {
      const [txid, vout] = id.split(':');
      const contract = tabContract({ ownerPub: this.agentPub, agentPub: this.agentPub, providerPub: hexToBin(t.providerPub), timeout: BigInt(t.timeout) }, this.cfg.provider);
      const utxo = (await contract.getUtxos()).find((u) => u.txid === txid && u.vout === Number(vout));
      if (!utxo) throw new Error('tab already spent');
      const tx = await buildRefund({ provider: this.cfg.provider, contract, tabUtxo: utxo, ownerPriv: this.cfg.agentPriv, timeout: BigInt(t.timeout), network: this.cfg.network }).send();
      t.closed = { action: 'refund', txid: tx.txid };
      this.save();
      return t.closed;
    }
    const r = await this.fetch(`${t.origin}/tabs/${id}/settle`, { method: 'POST' });
    const body = await r.json();
    if (!r.ok) throw new Error(`provider settle failed: ${body.error} ${body.message ?? ''}`);
    t.closed = { action: 'settle', txid: body.txid as string };
    this.save();
    return t.closed;
  }
}
