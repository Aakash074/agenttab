// Reads the faucet's spendable coins exactly as the server does (primary + bch.ninja mirror, relaying
// mirror-only coins to the primary). Usage: node packages/server/scripts/faucet-coins.ts [address] [--no-relay]
import { ElectrumNetworkProvider } from 'cashscript';
import { electrumProvider, p2pkhAddress, pubFromPriv } from '@agenttab/covenant';
import { faucetCoins } from '../src/faucet.ts';
import { loadEnv, testnetKey } from '../src/env.ts';

const arg = process.argv.slice(2).find((a) => a.startsWith('bchtest:'));
const address = arg ?? p2pkhAddress(pubFromPriv(testnetKey(loadEnv().FAUCET_WIF, 'FAUCET_WIF')), 'chipnet');
const primary = electrumProvider('chipnet');
const mirror = new ElectrumNetworkProvider('chipnet', { hostname: 'chipnet.bch.ninja' });
const before = (await primary.getUtxos(address)).reduce((s, u) => s + u.satoshis, 0n);
console.log('primary only (old logic):', before.toString(), 'sats');
if (process.argv.includes('--no-relay')) process.exit(0);
const c = await faucetCoins(primary, address, mirror);
console.log('spendable (new logic):', c.sats.toString(), 'sats in', c.utxos.length, 'coins; pending', c.pendingSats.toString());
process.exit(0);
