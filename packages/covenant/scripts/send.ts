// CHIPNET ONLY: send test sats from the OWNER key in ./.env to an address. Usage: send.ts <bchtest:addr> <sats>
import { readFileSync } from 'node:fs';
import { ElectrumNetworkProvider, SignatureTemplate, TransactionBuilder } from 'cashscript';
import { decodePrivateKeyWif } from '@bitauth/libauth';
import { p2pkhAddress, pubFromPriv } from '../src/index.ts';
const [to, amt] = process.argv.slice(2);
if (!to?.startsWith('bchtest:')) throw new Error('chipnet (bchtest:) addresses only');
const wif = readFileSync(new URL('../../../.env', import.meta.url), 'utf8').match(/^OWNER_WIF=(\S+)$/m)![1];
const d = decodePrivateKeyWif(wif); if (typeof d === 'string' || d.type !== 'testnet') throw new Error('need testnet key');
const net = new ElectrumNetworkProvider('chipnet');
const from = p2pkhAddress(pubFromPriv(d.privateKey), 'chipnet');
const utxos = (await net.getUtxos(from)).filter((u) => !u.token);
const amount = BigInt(amt);
const b = new TransactionBuilder({ provider: net }).addInputs(utxos, new SignatureTemplate(d.privateKey).unlockP2PKH())
  .addOutput({ to, amount });
b.addBchChangeOutputIfNeeded({ to: from, feeRate: 1 } as never);
const tx = await b.send();
console.log(tx.txid);
process.exit(0);
