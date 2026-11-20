export type JourneyStep = 'wallet' | 'coins' | 'open' | 'calls' | 'close';

/** The one-button run (connect → coins → open → N paid calls → close → change back). The ticket renders it. */
export interface JourneyState {
  active: boolean;
  step?: JourneyStep;
  error?: string;
  budget?: bigint;
  /** Budget was capped below the ~5¢ target by the wallet's balance. */
  capped?: boolean;
  openTxid?: string;
  /** Tab timeout (lock units), needed to re-register the same tab on resume. */
  timeout?: number;
  calls: number;
  /** Paid calls this run makes before the settle (3 on the Chipnet test wallet, 10 from a real wallet). */
  total?: number;
  /** Which wallet funds the run (copy differs: test coins vs real BCH). */
  walletKind?: 'wizard' | 'burner';
  /** Price per call and the latest voucher total, from the API answers. */
  price?: bigint;
  spent?: bigint;
  route?: string;
  closeTxid?: string;
  returned?: string;
  settled?: string;
  action?: 'settle' | 'cancel';
  done?: boolean;
  /** Live progress text (e.g. "Getting free test coins… 4 s"). */
  note?: string;
  /** The server stopped answering; the run is retrying on its own. */
  hiccup?: boolean;
  /** The free test-coin faucet is empty or rate-limited: offer the house agent's run (no coins needed) instead. */
  faucetOut?: boolean;
  /** When a rate-limited visitor may try the faucet again (ms epoch). */
  retryAt?: number;
}

export const IDLE_JOURNEY: JourneyState = { active: false, calls: 0 };
