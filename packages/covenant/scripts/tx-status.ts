// Prints confirmation status of chipnet txids: node packages/covenant/scripts/tx-status.ts <txid>...
import { ElectrumNetworkProvider } from 'cashscript';
const net = new ElectrumNetworkProvider('chipnet');
console.log('tip', await net.getBlockHeight());
for (const t of process.argv.slice(2)) {
  const r: any = await net.performRequest('blockchain.transaction.get', t, true);
  console.log(t, r?.confirmations ? `${r.confirmations} conf (block ${r.blockhash?.slice(0, 16)}…)` : 'in mempool (0-conf)');
}
process.exit(0);
