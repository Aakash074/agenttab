// Tops the server's chipnet FAUCET key up from the public BCH Ninja chipnet faucet (free test coins, PoW).
// Usage: node packages/server/scripts/faucet-topup.ts [sats=200000]
import { p2pkhAddress, pubFromPriv } from '@agenttab/covenant';
import { publicChipnetFaucet } from '../src/faucet.ts';
import { loadEnv, testnetKey } from '../src/env.ts';
const env = loadEnv();
const address = p2pkhAddress(pubFromPriv(testnetKey(env.FAUCET_WIF, 'FAUCET_WIF')), 'chipnet');
console.log('topping up', address);
console.log('txid', await publicChipnetFaucet(address, BigInt(process.argv[2] ?? 200_000)));
