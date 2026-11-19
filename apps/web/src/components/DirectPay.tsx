import { useEffect, useRef, useState } from 'react';
import { emitLanded } from './Backdrop';
import { explorerTx, type Net } from '../config';
import { ApiError, api, type DirectAnswer, type ServerInfo } from '../lib/api';
import { sats, short, usd } from '../lib/format';
import type { Wallet } from '../lib/wallet';

type State =
  | { s: 'idle' }
  | { s: 'connecting' }
  | { s: 'busy'; msg: string }
  | { s: 'done'; r: DirectAnswer }
  | { s: 'error'; msg: string };

/** Fee headroom for a one-input payment with change (~260 bytes at 1 sat/byte), rounded up. */
const FEE_ROOM = 600n;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function signError(e: unknown): string {
  const m = (e as Error)?.message ?? String(e);
  if ((e as Error)?.name === 'WalletDeclined' || /reject|declin|cancel|denied|refus/i.test(m)) return 'You declined the payment in your wallet. Nothing was sent.';
  if (/insufficient funds/i.test(m)) return 'Not enough BCH in this wallet for the payment plus the network fee.';
  return `Your wallet could not sign the payment: ${m}`;
}

/** "1¢ direct pay": the simplest human path. One on-chain payment from your own wallet, one oracle answer. */
export function DirectPay({ wallet, net, info, waking, onConnect, connectCancelled = 0, hero = false }: {
  wallet: Wallet | null; net: Net; info: ServerInfo | null; waking?: boolean; onConnect: () => void;
  /** Hero: the page's one filled button (mainnet). Otherwise a quieter card (inside "How it works"). */
  hero?: boolean;
  /** Changes when the visitor closed the connect dialog without connecting. */
  connectCancelled?: number;
}) {
  const [st, setSt] = useState<State>({ s: 'idle' });
  const pending = useRef(false);
  const priceSats = info?.features?.direct?.priceSats;
  const bchUsd = info?.bchUsd;
  const busy = st.s === 'busy' || st.s === 'connecting';

  useEffect(() => { setSt({ s: 'idle' }); pending.current = false; }, [net]);
  useEffect(() => {
    if (!connectCancelled) return;
    pending.current = false;
    setSt((s) => (s.s === 'connecting' ? { s: 'idle' } : s));
  }, [connectCancelled]);
  useEffect(() => {
    if (wallet && pending.current) { pending.current = false; void run(wallet); }
  }, [wallet]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(w: Wallet) {
    const say = (msg: string) => setSt({ s: 'busy', msg });
    let step: 'invoice' | 'funds' | 'sign' | 'pay' = 'invoice';
    try {
      say(waking || !info ? `Waking the ${net === 'mainnet' ? 'Mainnet' : 'Chipnet'} server (about 20 s)…` : 'Creating an invoice…');
      // The oracle returns the same live market data for any question, so we don't ask for one.
      const inv = await api.directInvoice('price');
      const amount = BigInt(inv.amountSats);
      step = 'funds';
      say('Checking your balance…');
      let bal = await w.balance();
      if (bal < amount + FEE_ROOM && w.kind === 'burner' && info?.features?.faucet) {
        say('Getting free test coins…');
        try { await api.drip(w.address); } catch (e) { if (!(e instanceof ApiError && e.status === 409)) throw e; }
        for (let i = 0; i < 16 && bal < amount + FEE_ROOM; i++) { await sleep(1000); bal = await w.balance(); }
      }
      if (bal < amount + FEE_ROOM) {
        throw new Error(`Insufficient funds: this wallet has ${sats(bal)} sats and the payment needs about ${sats(amount + FEE_ROOM)} (${sats(amount)} plus the network fee).${net === 'chipnet' ? ' Switch your wallet to chipnet and add test coins.' : ''}`);
      }
      step = 'sign';
      say(w.kind === 'wizard' ? `Approve the ${sats(amount)}-sat payment in ${w.label}…` : 'Signing…');
      const rawTx = await w.payDirect({ payTo: inv.payTo, amount, invoiceId: inv.invoiceId });
      step = 'pay';
      say('Broadcasting and checking the payment (0-conf)…');
      setSt({ s: 'done', r: await api.directPay(inv.invoiceId, rawTx) });
      emitLanded();
    } catch (e) {
      let msg: string;
      if (step === 'sign') msg = signError(e);
      else if (e instanceof ApiError) msg = e.status === 429 ? `${e.message}` : `The server refused: ${e.message}`;
      else if (e instanceof TypeError || (e as Error)?.name === 'TimeoutError') msg = 'The server is waking up (~30 s). Try again in a moment.';
      else msg = (e as Error).message;
      setSt({ s: 'error', msg });
    }
  }

  function start() {
    if (busy) return;
    if (!wallet) { pending.current = true; setSt({ s: 'connecting' }); onConnect(); return; }
    void run(wallet);
  }

  const c = bchUsd && priceSats ? Math.round((Number(priceSats) / 1e8) * bchUsd * 100) : 1;
  const price = c >= 1 && c < 100 ? `${c}¢` : '1¢';
  const status = (
    <div className="mt-2 min-h-[24px] text-sm" aria-live="polite">
      {st.s === 'idle' && (
        <p className="text-muted">{waking ? <span className="flex items-center gap-2"><span aria-hidden className="spin inline-block h-3 w-3 rounded-full border-2 border-current border-r-transparent" />Waking the {net === 'mainnet' ? 'Mainnet' : 'Chipnet'} server (about 20 s). You can press now.</span>
          : `One on-chain payment from Paytaca or any WizardConnect wallet${net === 'chipnet' ? ', or a free test wallet' : ''}.`}</p>
      )}
      {st.s === 'connecting' && (
        <p className="text-muted">Connect a wallet to pay. <button type="button" className="tap font-medium text-bch-2 hover:underline" onClick={() => { pending.current = false; setSt({ s: 'idle' }); }}>Cancel</button></p>
      )}
      {st.s === 'busy' && <p className="flex items-center gap-2 text-muted"><span className="h-1.5 w-1.5 shrink-0 rounded-full bg-bch pulse-dot" />{st.msg}</p>}
      {st.s === 'error' && (
        <p className="text-warn">{st.msg} <button type="button" className="tap ml-1 font-medium text-bch-2 hover:underline" onClick={() => setSt({ s: 'idle' })}>Dismiss</button></p>
      )}
      {st.s === 'done' && (
        <div className="slide-in mt-1 rounded-lg border border-line bg-panel px-3 py-2.5">
          <p className="text-fg">{st.r.answer ?? 'Paid.'}</p>
          <p className="mt-1.5 flex flex-wrap gap-x-3 font-mono text-[11.5px] text-dim">
            <span>paid {sats(st.r.amountSats)} sats{bchUsd ? ` (${cents(BigInt(st.r.amountSats), bchUsd)})` : ''}</span>
            <a className="tap text-bch-2 hover:underline" href={explorerTx(net, st.r.txid)} target="_blank" rel="noreferrer">tx {short(st.r.txid, 6)} ↗</a>
            <span className="whitespace-nowrap">0-conf</span>
          </p>
        </div>
      )}
    </div>
  );
  if (hero) {
    return (
      <div id="direct" className="scroll-mt-24 sm:max-w-lg">
        <button type="button" data-stream-src onClick={start} disabled={busy}
          className="btn-primary flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-bch px-6 text-base font-semibold text-on-bch hover:bg-bch-hover disabled:cursor-wait disabled:opacity-70 sm:w-auto">
          {busy && <span aria-hidden className="spin inline-block h-3.5 w-3.5 rounded-full border-2 border-current border-r-transparent" />}
          Pay {price} for a live BCH price
        </button>
        {status}
      </div>
    );
  }
  return (
    <div id="direct" className="scroll-mt-24 rounded-2xl border border-line bg-panel p-5 card">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h3 className="font-semibold">No tab: pay once</h3>
          <p className="mt-0.5 text-sm text-muted">Be the agent. One {priceSats ? `${sats(priceSats)}-sat` : '1¢'} payment buys one live BCH price.</p>
        </div>
        <button type="button" onClick={start} disabled={busy}
          className="min-h-[44px] shrink-0 whitespace-nowrap rounded-lg border border-line-2 bg-panel px-4 text-sm font-semibold transition hover:bg-subtle disabled:cursor-wait disabled:opacity-60">
          Pay {price}
        </button>
      </div>
      {status}
    </div>
  );
}

/** "1.0¢" for amounts under a dollar (the 4-decimal dollar form over-states precision). */
function cents(satoshis: bigint, bchUsd: number) {
  const c = (Number(satoshis) / 1e8) * bchUsd * 100;
  return c < 100 ? `${c.toFixed(1)}¢` : usd(satoshis, bchUsd);
}
