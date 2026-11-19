export type JourneyStep = 'wallet' | 'coins' | 'open' | 'calls' | 'close';

/** The one-button run (connect → coins → open → 3 paid calls → close → change back). The ticket renders it. */
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
}

export const IDLE_JOURNEY: JourneyState = { active: false, calls: 0 };
