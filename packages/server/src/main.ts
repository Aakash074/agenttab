// Chipnet paywall server. PORT, PROVIDER_WIF (testnet) from env / .env.
import { ElectrumNetworkProvider } from 'cashscript';
import { TabLedger } from './ledger.ts';
import { createApp } from './app.ts';
import { loadEnv, repoRoot, testnetKey } from './env.ts';

const env = loadEnv();
const network = 'chipnet' as const;
const ledger = new TabLedger({
  provider: new ElectrumNetworkProvider(network),
  providerPriv: testnetKey(env.PROVIDER_WIF, 'PROVIDER_WIF'),
  network,
  file: new URL('.data/tabs.json', repoRoot).pathname,
});
const facts = [
  'BCH blocks are ~32MB with sub-cent fees, so a 1000-sat API call is economical.',
  'CashTokens (May 2023) added native fungible tokens and NFTs to BCH.',
  'The 2025 VM limits upgrade made larger covenant scripts practical on BCH.',
  'OP_CHECKDATASIG lets a BCH script verify a signature over arbitrary data, which is what AgentTab vouchers use.',
];
const app = createApp({
  ledger, network, adminToken: env.ADMIN_TOKEN,
  routes: [{
    path: '/api/oracle', price: 1000n, description: 'BCH Oracle: one answer per call',
    handler: (u) => ({ q: u.searchParams.get('q'), answer: facts[Math.floor(Math.random() * facts.length)], at: new Date().toISOString() }),
  }],
});
const port = Number(env.PORT ?? 8402);
app.listen(port, () => console.log(`AgentTab paywall on http://localhost:${port} (provider ${ledger.providerPubHex()})`));
