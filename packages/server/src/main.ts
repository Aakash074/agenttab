// AgentTab paywall server. Env (.env or process): NETWORK=chipnet|mainnet (mainnet needs ALLOW_MAINNET=1),
// PROVIDER_WIF, PORT (8402), ADMIN_TOKEN (optional, guards /settle), TICK_SECONDS (30), SAFETY_BLOCKS (6),
// PRICE_SATS (1000).
import { ElectrumNetworkProvider } from 'cashscript';
import { TabLedger } from './ledger.ts';
import { createApp } from './app.ts';
import { loadEnv, networkKey, repoRoot, resolveNetwork } from './env.ts';
import { oracleHandler } from './oracle.ts';

const env = loadEnv();
const network = resolveNetwork(env);
const provider = new ElectrumNetworkProvider(network);
const ledger = new TabLedger({
  provider, network,
  providerPriv: networkKey(env.PROVIDER_WIF, 'PROVIDER_WIF', network),
  safetyBlocks: Number(env.SAFETY_BLOCKS ?? 6),
  file: new URL(`.data/tabs-${network}.json`, repoRoot).pathname,
});
const app = createApp({
  ledger, network, adminToken: env.ADMIN_TOKEN,
  routes: [{
    path: '/api/oracle', price: BigInt(env.PRICE_SATS ?? 1000),
    description: 'BCH market oracle: live BCH/USD + chain tip, per call',
    handler: oracleHandler(provider, network),
  }],
});
await ledger.refreshTip();
const tick = async () => {
  try {
    const r = await ledger.tick();
    if (r.settled.length || r.expired.length) console.log('tick', r);
  } catch (e) { console.error('tick failed', (e as Error).message); }
};
setInterval(tick, Number(env.TICK_SECONDS ?? 30) * 1000);
const port = Number(env.PORT ?? 8402);
app.listen(port, () => console.log(`AgentTab paywall [${network}] http://localhost:${port}  tip ${ledger.tip}  provider ${ledger.providerPubHex()}`));
