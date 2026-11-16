import { useEffect, useRef, useState } from 'react';
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
export function DirectPay({ wallet, net, info, waking, onConnect, connectCancelled = 0 }: {
  wallet: Wallet | null; net: Net; info: ServerInfo | null; waking?: boolean; onConnect: () => void;
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
      say(waking || !info ? 'Waking the server (~30 s)…' : 'Creating an invoice…');
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

  const amount = priceSats ? `${sats(priceSats)}-sat` : '1¢';
  return (
    <div id="direct" className="scroll-mt-24 sm:max-w-xl" aria-live="polite">
      <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-dim">Quick: one 1¢ payment</p>
      <div className="card rounded-2xl border border-line bg-panel p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">Be the agent: pay 1¢ for one API answer</h2>
            <p className="mt-0.5 text-xs text-muted">Live BCH/USD, 24h change and the {net} block height. One {amount} payment{bchUsd && priceSats ? ` (${cents(BigInt(priceSats), bchUsd)})` : ''}, accepted at <span className="whitespace-nowrap">0-conf</span>.</p>
          </div>
          <button type="button" onClick={start} disabled={busy}
            className="min-h-[44px] shrink-0 whitespace-nowrap rounded-lg border border-bch bg-panel px-4 text-sm font-semibold text-bch-2 transition hover:bg-bch/10 disabled:cursor-wait disabled:opacity-60">
            Get BCH price — 1¢
          </button>
        </div>
        <div className="mt-2 min-h-[40px] text-sm">
          {st.s === 'idle' && (
            <p className="text-muted">{waking ? `Waking the ${net} server (~30 s)… You can press the button now.` : net === 'chipnet' ? 'Pay with Paytaca (WizardConnect). No BCH wallet? Use a free chipnet test wallet, one click.' : 'Pay with Paytaca or any WizardConnect wallet.'}</p>
          )}
          {st.s === 'connecting' && (
            <p className="text-muted">Connect a wallet to pay. <button type="button" className="tap font-medium text-bch-2 hover:underline" onClick={() => { pending.current = false; setSt({ s: 'idle' }); }}>Cancel</button></p>
          )}
          {st.s === 'busy' && <p className="flex items-center gap-2 text-muted"><span className="h-1.5 w-1.5 shrink-0 rounded-full bg-bch pulse-dot" />{st.msg}</p>}
          {st.s === 'error' && (
            <p className="text-warn">{st.msg} <button type="button" className="tap ml-1 font-medium text-bch-2 hover:underline" onClick={() => setSt({ s: 'idle' })}>Dismiss</button></p>
          )}
          {st.s === 'done' && (
            <div className="slide-in mt-1 rounded-lg border border-line bg-panel-2 px-3 py-2.5">
              <p className="text-fg">{st.r.answer ?? 'Paid.'}</p>
              <p className="mt-1.5 flex flex-wrap gap-x-3 font-mono text-[11px] text-dim">
                <span>paid {sats(st.r.amountSats)} sats{bchUsd ? ` (${cents(BigInt(st.r.amountSats), bchUsd)})` : ''}</span>
                <a className="tap text-bch-2 hover:underline" href={explorerTx(net, st.r.txid)} target="_blank" rel="noreferrer">tx {short(st.r.txid, 6)} ↗</a>
                <span className="whitespace-nowrap">0-conf</span>
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** "1.0¢" for amounts under a dollar (the 4-decimal dollar form over-states precision). */
function cents(satoshis: bigint, bchUsd: number) {
  const c = (Number(satoshis) / 1e8) * bchUsd * 100;
  return c < 100 ? `${c.toFixed(1)}¢` : usd(satoshis, bchUsd);
}
