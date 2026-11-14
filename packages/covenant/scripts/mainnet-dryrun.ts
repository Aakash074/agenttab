// MAINNET DRY RUN: never signs with a real key and never broadcasts.
// Connects to mainnet Electrum (read-only), derives a tab contract, and, if you pass a mainnet address
// that holds a few thousand sats, builds the unsigned WizardConnect "open tab" tx a wallet would be asked
// to sign, then prints its size/fee/outputs.
// Usage: node packages/covenant/scripts/mainnet-dryrun.ts [bitcoincash:q...funding address] [budgetSats=3000]
import { ElectrumNetworkProvider, placeholderP2PKHUnlocker } from 'cashscript';
import { cashAddressToLockingBytecode, generatePrivateKey } from '@bitauth/libauth';
import { buildOpen, pubFromPriv, tabContract } from '../src/index.ts';

const [fundingAddress, budgetArg] = process.argv.slice(2);
const net = new ElectrumNetworkProvider('mainnet');
const tip = await net.getBlockHeight();
console.log('mainnet tip', tip);

// Throwaway keys stand in for owner/agent/provider: nothing here can move real funds.
const k = () => pubFromPriv(generatePrivateKey());
const ownerPub = k(), agentPub = k(), providerPub = k();
const timeout = BigInt(tip + 144);
const contract = tabContract({ ownerPub, agentPub, providerPub, timeout }, net);
console.log('example tab contract', contract.address, `(${contract.bytesize} bytes)`);

if (fundingAddress) {
  const lb = cashAddressToLockingBytecode(fundingAddress);
  if (typeof lb === 'string' || !fundingAddress.startsWith('bitcoincash:')) throw new Error('pass a mainnet bitcoincash: address');
  const utxos = (await net.getUtxos(fundingAddress)).filter((u) => !u.token);
  const budget = BigInt(budgetArg ?? 3000);
  console.log(`funding utxos: ${utxos.length}, total ${utxos.reduce((s, u) => s + u.satoshis, 0n)} sats`);
  const builder = buildOpen({ provider: net, contract, unlocker: placeholderP2PKHUnlocker(fundingAddress), fundingUtxos: utxos, budget, changeAddress: fundingAddress });
  const wc = builder.generateWcTransactionObject({ broadcast: false, userPrompt: 'Open an AgentTab (dry run)' });
  console.log('unsigned open tx:', {
    inputs: wc.transaction.inputs.length,
    outputs: wc.transaction.outputs.map((o) => o.valueSatoshis.toString()),
    sizeBytes: builder.getTransactionSize().toString(),
  });
  console.log('NOT signed, NOT broadcast.');
}
process.exit(0);
