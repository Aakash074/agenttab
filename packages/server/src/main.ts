import { binToHex, electrumProvider, p2pkhAddress, pubFromPriv } from '@agenttab/covenant';
// AgentTab paywall server.
// Env (.env or process):
//   NETWORK=chipnet|mainnet (mainnet needs ALLOW_MAINNET=1 and mainnet WIFs), PROVIDER_WIF, PORT (8402),
//   KEY_SEED (hosted: derives any unset role WIFs, see env.ts withSeedKeys); ADMIN_TOKEN (optional, guards /settle), TICK_SECONDS (30), SAFETY_BLOCKS (6), PRICE_SATS (1000),
//   MAX_TAB_BUDGET_SATS (chipnet: none, mainnet default 100000),
//   DEMO_AGENT_WIF (or AGENT_WIF) to host the demo agent; DEMO_CRON_SECONDS (60; 0 = off); DEMO_BUDGET_SATS (20000);
//   DEMO_ON_MAINNET=1 to allow the demo agent on mainnet (off by default);
//   DEMO_IDLE_SECONDS (600: cron rate when nobody watches the feed);
//   FAUCET_WIF + DRIP_SATS (25000) for the chipnet-only test-wallet drip, FAUCET_TOPUP_BELOW_SATS (100000, from the
//   public chipnet PoW faucet); TRUST_PROXY=1 behind a reverse proxy;
//   DIRECT_PRICE_SATS (1¢ direct pay price; default ≈1 US cent at the live BCH price, never below dust).
import { ElectrumNetworkProvider } from 'cashscript';
import { TabLedger } from './ledger.ts';
import { createApp, type ExtraHandler } from './app.ts';
import { loadEnv, networkKey, repoRoot, resolveNetwork, withSeedKeys } from './env.ts';
import { bchPriceCached, fxHandler, oracleHandler, tipHandler } from './oracle.ts';
import { createDemo } from './demo.ts';
import { createFaucet } from './faucet.ts';
import { createAttacks } from './attacks.ts';
import { electrumSource, replayFromChain } from './replay.ts';
import { centInSats, createDirect } from './direct.ts';

const network = resolveNetwork(loadEnv());
const env = withSeedKeys(loadEnv(), network);
const mainnet = network === 'mainnet';
const provider = electrumProvider(network);
const price = BigInt(env.PRICE_SATS ?? (mainnet ? 600 : 1000));
const maxBudget = env.MAX_TAB_BUDGET_SATS ? BigInt(env.MAX_TAB_BUDGET_SATS) : mainnet ? 100_000n : undefined;
const providerPriv = networkKey(env.PROVIDER_WIF, 'PROVIDER_WIF', network);
const ledger = new TabLedger({
  provider, network, providerPriv,
  safetyBlocks: Number(env.SAFETY_BLOCKS ?? 6),
  maxBudgetSats: maxBudget,
  file: new URL(`.data/tabs-${network}.json`, repoRoot).pathname,
});
const port = Number(env.PORT ?? (mainnet ? 8403 : 8402));
const route = '/api/oracle';
const trustProxy = env.TRUST_PROXY === '1';

const extra: ExtraHandler[] = [];
const features: Record<string, unknown> = { maxBudgetSats: maxBudget?.toString() ?? null };

const demoWif = env.DEMO_AGENT_WIF ?? env.AGENT_WIF;
let demo: ReturnType<typeof createDemo> | undefined;
// Mainnet: the demo agent is off unless DEMO_ON_MAINNET=1, and then it only spends tabs visitors fund for it.
if (demoWif && (!mainnet || env.DEMO_ON_MAINNET === '1')) {
  demo = createDemo({
    ledger, provider, network, agentPriv: networkKey(demoWif, 'DEMO_AGENT_WIF', network),
    selfUrl: () => `http://127.0.0.1:${port}`, route, price,
    extraRoutes: [{ path: '/api/fx', price: (price * 6n) / 10n }, { path: '/api/chain/tip', price: (price * 3n) / 10n }],
    budgetSats: BigInt(env.DEMO_BUDGET_SATS ?? 20_000),
    stateFile: new URL(`.data/demo-agent-${network}.json`, repoRoot).pathname, trustProxy,
    // testnet only: sweep provider proceeds back to the demo agent so the live demo never runs dry
    recycleFromPriv: mainnet ? undefined : providerPriv,
    idleSeconds: Number(env.DEMO_IDLE_SECONDS ?? 600),
    visitorTabsOnly: mainnet,
    maxTotalSats: mainnet ? BigInt(env.DEMO_MAINNET_MAX_TOTAL_SATS ?? 50_000) : undefined,
  });
  extra.push(demo.handler);
  features.demo = { agentPub: demo.agent.agentPubHex, cronSeconds: mainnet ? 0 : Number(env.DEMO_CRON_SECONDS ?? 60), visitorTabsOnly: mainnet };
}
if (!mainnet && env.FAUCET_WIF) {
  const faucet = createFaucet({
    network, provider, faucetPriv: networkKey(env.FAUCET_WIF, 'FAUCET_WIF', network), dripSats: BigInt(env.DRIP_SATS ?? 25_000), trustProxy,
    topUpBelowSats: BigInt(env.FAUCET_TOPUP_BELOW_SATS ?? 100_000),
  });
  extra.push(faucet.handler);
  faucet.maybeTopUp().catch(() => {});
  setInterval(() => faucet.maybeTopUp().catch(() => {}), 30 * 60_000);
  features.faucet = { dripSats: env.DRIP_SATS ?? '25000', address: faucet.address };
}

const attackOwner = env.ATTACK_OWNER_WIF ?? env.OWNER_WIF;
const tagOwners: Record<string, string> = {};
if (!mainnet && attackOwner) {
  tagOwners[binToHex(pubFromPriv(networkKey(attackOwner, 'ATTACK_OWNER_WIF', network)))] = 'attack';
  const attacks = createAttacks({
    ledger, provider, network: 'chipnet', ownerPriv: networkKey(attackOwner, 'ATTACK_OWNER_WIF', network), providerPriv,
    selfUrl: () => `http://127.0.0.1:${port}`, price, file: new URL(`.data/attacks-${network}.json`, repoRoot).pathname,
  });
  extra.push(attacks.handler);
  features.attacks = true;
}

// 1¢ direct pay: a human pays one on-chain tx (0-conf) for one oracle answer, no tab needed.
const directPrice = () => {
  const v = env.DIRECT_PRICE_SATS ? BigInt(env.DIRECT_PRICE_SATS) : centInSats(bchPriceCached());
  return v < 546n ? 546n : v; // never below dust
};
const oracle = oracleHandler(provider, network);
const direct = createDirect({
  ledger, network, payTo: p2pkhAddress(ledger.providerPub, network), priceSats: directPrice, answer: oracle, route, trustProxy,
  broadcast: (hex) => provider.sendRawTransaction(hex), fetchRawTx: (txid) => provider.getRawTransaction(txid),
  file: new URL(`.data/direct-${network}.json`, repoRoot).pathname,
});
extra.push(direct.handler);
features.direct = { path: '/direct', payTo: direct.payTo, get priceSats() { return directPrice().toString(); } };

const app = createApp({
  ledger, network, adminToken: env.ADMIN_TOKEN, extra, features, bchUsd: async () => bchPriceCached(),
  direct: { route, payTo: direct.payTo, priceSats: directPrice },
  routes: [
    { path: route, price, description: 'BCH market oracle: live BCH/USD + chain tip, per call', handler: oracle },
    { path: '/api/fx', price: (price * 6n) / 10n, description: 'BCH in USD/EUR/INR/JPY', handler: fxHandler() },
    { path: '/api/chain/tip', price: (price * 3n) / 10n, description: 'Chain tip + block time', handler: tipHandler(provider, network) },
  ],
});
await ledger.refreshTip();
const tick = async () => {
  try {
    const r = await ledger.tick();
    if (r.settled.length || r.expired.length) console.log('tick', r);
  } catch (e) { console.error('tick failed', (e as Error).message); }
};
setInterval(tick, Number(env.TICK_SECONDS ?? 30) * 1000);
app.listen(port, () => {
  console.log(`AgentTab paywall [${network}] http://localhost:${port}  tip ${ledger.tip}  provider ${ledger.providerPubHex()}  price ${price}`);
  if (demo) demo.startCron(Number(env.DEMO_CRON_SECONDS ?? 60));
  // Disk wiped on restart (free hosting)? Rebuild settled tabs from the provider address's chain history.
  if (env.REPLAY_FROM_CHAIN !== '0') {
    replayFromChain(ledger, electrumSource(provider), { maxPrice: price, tagOwners, limit: Number(env.REPLAY_LIMIT ?? 300) })
      .then((n) => n && console.log(`replayed ${n} settled tab(s) from chain`))
      .catch((e) => console.error('chain replay failed', (e as Error).message));
  }
  console.log(`demo agent: ${demo ? 'on' : 'off'}  faucet drip: ${features.faucet ? 'on' : 'off'}  max tab: ${maxBudget ?? 'none'}`);
});
