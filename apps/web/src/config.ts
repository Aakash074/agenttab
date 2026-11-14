export type Net = 'chipnet' | 'mainnet';

/** Banner placeholders: fill before submission (BLAZE rule: deck, repo, CashTokens z-address, disclosure). */
export const BANNER = {
  event: 'BCH BLAZE 2026',
  deckUrl: import.meta.env.VITE_DECK_URL ?? '',
  repoUrl: import.meta.env.VITE_REPO_URL ?? '',
  donationZAddress: import.meta.env.VITE_DONATION_ZADDR ?? '',
  prototypeUrl: import.meta.env.VITE_PROTOTYPE_URL ?? '',
};

/** Paywall server base URL per network ('' = same origin / Vite dev proxy). */
export const SERVERS: Record<Net, string> = {
  chipnet: (import.meta.env.VITE_SERVER_URL_CHIPNET ?? '').replace(/\/$/, ''),
  mainnet: (import.meta.env.VITE_SERVER_URL_MAINNET ?? '').replace(/\/$/, ''),
};

/** Public key of the demo agent (shown as a one-click default when funding a tab). */
export const DEMO_AGENT_PUB: string = import.meta.env.VITE_DEMO_AGENT_PUB ?? '';

/** Mainnet is selectable only when a mainnet API server is configured. */
export const MAINNET_ENABLED = !!import.meta.env.VITE_SERVER_URL_MAINNET || import.meta.env.VITE_ENABLE_MAINNET === '1';

export const explorerTx = (net: Net, txid: string) =>
  net === 'mainnet' ? `https://explorer.bch.ninja/tx/${txid}` : `https://chipnet.imaginary.cash/tx/${txid}`;
export const explorerAddr = (net: Net, address: string) =>
  net === 'mainnet' ? `https://explorer.bch.ninja/address/${address}` : `https://chipnet.imaginary.cash/address/${address}`;

/** Budgets offered per network (mainnet kept tiny). */
export const BUDGETS: Record<Net, bigint[]> = { chipnet: [5_000n, 20_000n, 100_000n], mainnet: [3_000n, 5_000n, 10_000n] };
export const CONTRACT_SOURCE_URL = BANNER.repoUrl ? `${BANNER.repoUrl.replace(/\/$/, '')}/blob/main/packages/covenant/contracts/AgentTab.cash` : '';

/** Refund timeouts. The provider stops accepting vouchers 6 blocks (~1 h) before the timeout, so 12 blocks is the shortest useful tab. */
export const DURATIONS = [
  { label: '2 hours', blocks: 12 },
  { label: '1 day', blocks: 144 },
  { label: '1 week', blocks: 1008 },
];
