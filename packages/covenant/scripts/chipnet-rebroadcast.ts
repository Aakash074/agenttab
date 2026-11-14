// Re-broadcasts transactions that only one Electrum server's node knows about to other chipnet servers.
// Pulls every mempool tx touching the given addresses from SOURCE, orders parents before children, and
// pushes each raw tx to TARGET. Usage:
//   node packages/covenant/scripts/chipnet-rebroadcast.ts <source host> <target host> <bchtest:addr>...
import { ElectrumClient } from '@electrum-cash/network';
import { cashAddressToLockingBytecode, sha256, binToHex, decodeTransaction, hexToBin } from '@bitauth/libauth';

const [srcHost, dstHost, ...addrs] = process.argv.slice(2);
const connect = async (h: string) => { const c = new ElectrumClient('agenttab-rebroadcast', '1.5', h); await c.connect(); return c; };
const src = await connect(srcHost), dst = await connect(dstHost);
const call = async (c: ElectrumClient<never>, m: string, ...p: unknown[]) => { const r = await c.request(m, ...(p as never[])); if (r instanceof Error) throw r; return r; };

const txs = new Map<string, string>(); // txid -> hex
for (const a of addrs) {
  const lb = cashAddressToLockingBytecode(a);
  if (typeof lb === 'string') throw new Error(lb);
  const sh = binToHex(sha256.hash(lb.bytecode).reverse());
  const hist = await call(src as never, 'blockchain.scripthash.get_history', sh) as { tx_hash: string; height: number }[];
  for (const h of hist) if (h.height <= 0 && !txs.has(h.tx_hash)) txs.set(h.tx_hash, await call(src as never, 'blockchain.transaction.get', h.tx_hash) as string);
}
// Pull in unconfirmed parents too (e.g. covenant utxos funded by txs not touching these addresses).
let grew = true;
while (grew) {
  grew = false;
  for (const hex of [...txs.values()]) {
    const tx = decodeTransaction(hexToBin(hex));
    if (typeof tx === 'string') continue;
    for (const i of tx.inputs) {
      const parent = binToHex(i.outpointTransactionHash);
      if (txs.has(parent)) continue;
      const v = await call(src as never, 'blockchain.transaction.get', parent, true).catch(() => undefined) as { confirmations?: number; hex: string } | undefined;
      if (v && !v.confirmations) { txs.set(parent, v.hex); grew = true; }
    }
  }
}
// Topological order: parents first.
const parents = new Map([...txs].map(([id, hex]) => {
  const tx = decodeTransaction(hexToBin(hex));
  return [id, typeof tx === 'string' ? [] : tx.inputs.map((i) => binToHex(i.outpointTransactionHash)).filter((p) => txs.has(p))];
}));
const done = new Set<string>(), order: string[] = [];
const visit = (id: string) => { if (done.has(id)) return; done.add(id); for (const p of parents.get(id) ?? []) visit(p); order.push(id); };
for (const id of txs.keys()) visit(id);

let ok = 0, known = 0, fail = 0;
for (const id of order) {
  try { await call(dst as never, 'blockchain.transaction.broadcast', txs.get(id)!); ok++; }
  catch (e) {
    const m = (e as Error).message;
    if (/already|known|txn-mempool-conflict|missing-inputs/i.test(m) && /already|known/i.test(m)) known++;
    else { fail++; console.log('FAIL', id.slice(0, 12), m.slice(0, 160)); }
  }
}
console.log(`unconfirmed txs found: ${txs.size}; broadcast ok: ${ok}; already known: ${known}; failed: ${fail}`);
process.exit(0);
