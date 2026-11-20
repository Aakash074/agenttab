// The hero's one-button 5¢ tab: which wallets may fund it, how many paid calls the agent makes,
// and how big the tab is. Pure (no chain, no React) so the mainnet rules are unit-tested.
import type { Net } from '../config';

export type WalletKind = 'wizard' | 'burner';

export const DUST = 546n;
/** Left in the wallet for the open tx's miner fee. */
export const FEE_ROOM = 600n;
/** Never lock more than this in the hero tab, whatever the price feed says (≈6¢ at $200/BCH). */
export const JOURNEY_CAP_SATS = 30_000n;
/** Paid calls on a tab funded from a real wallet (WizardConnect), on any network. */
export const WALLET_TAB_CALLS = 10;
/** Calls on the Chipnet one-click test-wallet demo (unchanged). */
export const TEST_WALLET_CALLS = 3;

/** Wallets the hero's 5¢ tab may use. Mainnet: WizardConnect only, never a test wallet. */
export function journeyWallets(net: Net): WalletKind[] {
  return net === 'mainnet' ? ['wizard'] : ['burner', 'wizard'];
}

/** Throws unless `kind` may fund the hero tab on `net` (and the wallet is on that network). */
export function assertJourneyWallet(net: Net, w: { kind: WalletKind; net: Net }) {
  if (w.net !== net) throw new Error(`Your wallet is connected to ${w.net}, not ${net}. Reconnect it.`);
  if (!journeyWallets(net).includes(w.kind)) throw new Error('On Mainnet the 5¢ tab is funded only from your own wallet via WizardConnect.');
}

/** N paid calls the demo agent makes before the provider settles. */
export function journeyCalls(net: Net, kind: WalletKind): number {
  return net === 'mainnet' || kind === 'wizard' ? WALLET_TAB_CALLS : TEST_WALLET_CALLS;
}

/** Sats for `cents` US cents at `bchUsd`, rounded up. */
export const centsToSats = (cents: number, bchUsd: number) => BigInt(Math.ceil((cents / 100 / bchUsd) * 1e8));

/**
 * Tab size: ≈5¢ at the live price on mainnet (20,000 test sats on chipnet), never below what N calls + dust
 * + the settle fee need, never above JOURNEY_CAP_SATS or the wallet balance.
 */
export function journeyBudget(p: { net: Net; price: bigint; calls: number; balance: bigint; bchUsd?: number }) {
  const min = BigInt(p.calls) * p.price + DUST + 1_000n;
  let target: bigint;
  if (p.net === 'chipnet') target = 20_000n;
  else {
    if (!p.bchUsd || !(p.bchUsd > 0)) throw new Error('The live BCH price is not available yet, so the 5¢ tab cannot be sized. Try again in a moment.');
    target = centsToSats(5, p.bchUsd);
  }
  if (target < min) target = min;
  const capped = target > JOURNEY_CAP_SATS ? JOURNEY_CAP_SATS : target;
  const afford = ((p.balance - FEE_ROOM) / 100n) * 100n;
  const b = capped < afford ? capped : afford;
  return { budget: b < min ? min : b, min, target: capped, enough: afford >= min };
}

const n = (v: bigint) => v.toLocaleString('en-US');
const cents = (v: bigint, bchUsd: number) => `${(Math.round((Number(v) / 1e8) * bchUsd * 1000) / 10).toString()}¢`;

/** Mainnet confirmation copy for the hero tab (shown before WizardConnect). */
export function mainnetTabCopy(p: { budget: bigint; bchUsd: number; calls: number; price: bigint }) {
  const spend = BigInt(p.calls) * p.price;
  return {
    title: `Real BCH, ~${cents(p.budget, p.bchUsd)} (${n(p.budget)} sats)`,
    body: `You approve one transaction in your wallet that locks ${n(p.budget)} sats in the tab covenant. The agent makes ${p.calls} paid calls `
      + `(${n(spend)} sats, ~${cents(spend, p.bchUsd)}) with off-chain vouchers, then the provider settles in one transaction. `
      + 'The unspent part returns to your wallet automatically on settle.',
    refund: 'If the server ever stops, you can refund the whole tab yourself from "Your tabs" after its timeout (about 2 hours).',
  };
}
