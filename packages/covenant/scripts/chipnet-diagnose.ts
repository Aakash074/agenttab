// Chipnet confirmation diagnostics: queries several Electrum servers for tip, relay fee, mempool,
// recent block contents (does each block contain any non-coinbase tx?) and the status of given txids.
// Usage: node packages/covenant/scripts/chipnet-diagnose.ts [txid ...]
import { ElectrumClient } from '@electrum-cash/network';

const HOSTS = ['chipnet.bch.ninja', 'chipnet.imaginary.cash', 'chipnet.c3-soft.com', 'cbch.loping.net'];
const txids = process.argv.slice(2);

async function probe(host: string) {
  const c = new ElectrumClient('agenttab-diagnose', '1.5', host);
  const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 15_000));
  try {
    await Promise.race([c.connect(), timeout]);
  } catch (e) { return { host, error: `connect: ${(e as Error).message}` }; }
  const req = async (m: string, ...p: unknown[]) => {
    try { const r = await Promise.race([c.request(m, ...(p as never[])), timeout]); return r instanceof Error ? `ERR ${r.message}` : r; }
    catch (e) { return `ERR ${(e as Error).message}`; }
  };
  const tipHeader = await req('blockchain.headers.get_tip') as { height: number } | string;
  const tip = typeof tipHeader === 'object' ? tipHeader.height : undefined;
  const out: Record<string, unknown> = { host, tip, relayfee: await req('blockchain.relayfee'), mempool: await req('mempool.get_info') };
  if (tip) {
    const blocks: Record<number, string> = {};
    for (let h = tip; h > tip - 12; h--) {
      const r = await req('blockchain.transaction.id_from_pos', h, 1);
      const hdr = await req('blockchain.block.header', h) as string;
      const time = typeof hdr === 'string' && hdr.length >= 160 ? Buffer.from(hdr.slice(136, 144), 'hex').readUInt32LE(0) : 0;
      blocks[h] = `${new Date(time * 1000).toISOString()} ${typeof r === 'string' && !r.startsWith('ERR') ? 'HAS non-coinbase txs' : 'coinbase only'}`;
    }
    out.blocks = blocks;
  }
  const status: Record<string, unknown> = {};
  for (const t of txids) {
    const r = await req('blockchain.transaction.get', t, true) as { confirmations?: number; size?: number } | string;
    status[t.slice(0, 12)] = typeof r === 'object' ? (r.confirmations ? `${r.confirmations} conf` : 'known, 0-conf') : String(r).slice(0, 80);
  }
  out.txs = status;
  await c.disconnect(true).catch(() => {});
  return out;
}

for (const h of HOSTS) console.log(JSON.stringify(await probe(h), null, 1));
process.exit(0);
