// Headless WizardConnect WALLET for testing the dapp's WizardConnect path without a phone. CHIPNET ONLY.
//
//   node packages/covenant/scripts/wc-test-wallet.ts                  # print the wallet's address + balance, exit
//   node packages/covenant/scripts/wc-test-wallet.ts --drip           # ...and ask the hosted chipnet faucet for coins
//   node packages/covenant/scripts/wc-test-wallet.ts "wiz://?p=...&s=..." [--verbose]
//
// Paste the URI from the dapp's "Connect with WizardConnect" dialog. The wallet pairs over the real
// WizardConnect relay (relay.riften.net / relay.cauldron.quest), shares BIP44 chain xpubs for
// receive/change/defi (m/44'/145'/0'/{0,1,7}), auto-approves every sign_transaction_request, signs
// each input listed in inputPaths (P2PKH, or a contract input's placeholder signature) with
// SIGHASH_ALL|FORKID|UTXOS, checks the result in the libauth VM, and returns it. It never broadcasts
// (the dapp does). The mnemonic lives in .data/wc-test-wallet.json (gitignored) and is reused.
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import {
  binToHex, generateBip39Mnemonic, lockingBytecodeToCashAddress, sha256, utf8ToBin,
} from '@bitauth/libauth';
// @wizardconnect/core is a dependency of apps/web (hoisted to the root node_modules).
import {
  RelayMsgAction, PROTOCOL_NAME, chunkExtensionAdvertisement, decodeKeyExchangeURI, initiateWalletRelay,
  isSignTransactionRequest, peerSupportsChunk, type RelayClient,
} from '@wizardconnect/core';
import { electrumProvider, p2pkhAddress } from '../src/index.ts';
import { decodeWcTransaction, hdWallet, signWcRequest } from './lib/wc-signer.ts';

const root = new URL('../../../', import.meta.url);
const dataDir = new URL('.data/', root);
const walletFile = new URL('wc-test-wallet.json', dataDir);
const logFile = new URL('wc-test-wallet.log.jsonl', dataDir);
const API = process.env.AGENTTAB_API ?? 'https://agenttab-api-chipnet.onrender.com';

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const uri = args.find((a) => a.toLowerCase().startsWith('wiz://'));

// Relay library logs every packet with console.log('[relay] ...'); keep that behind --verbose.
if (!verbose) {
  const orig = console.log.bind(console);
  console.log = (...a: unknown[]) => { if (typeof a[0] === 'string' && a[0].startsWith('[relay]')) return; orig(...a); };
}
const ts = () => new Date().toISOString().slice(11, 19);
const say = (...a: unknown[]) => process.stdout.write(`${ts()} ${a.join(' ')}\n`);
const record = (dir: 'in' | 'out', msg: unknown) => appendFileSync(logFile, JSON.stringify({ at: new Date().toISOString(), dir, msg }) + '\n');

// ---------- wallet ----------
mkdirSync(dataDir, { recursive: true });
let stored: { network: string; mnemonic: string; createdAt: string };
if (existsSync(walletFile)) {
  stored = JSON.parse(readFileSync(walletFile, 'utf8'));
  if (stored.network !== 'chipnet') throw new Error(`${walletFile.pathname} is not a chipnet wallet; refusing`);
} else {
  stored = { network: 'chipnet', mnemonic: generateBip39Mnemonic(), createdAt: new Date().toISOString() };
  writeFileSync(walletFile, JSON.stringify(stored, null, 2) + '\n', { mode: 0o600 });
  say(`created a new chipnet test wallet in ${walletFile.pathname}`);
}
const wallet = hdWallet(stored.mnemonic);
const addr = (path: string, i: number) => p2pkhAddress(wallet.key(path, i).pub, 'chipnet');
const receive0 = addr('receive', 0);
say(`wallet receive/0: ${receive0}`);

const net = electrumProvider('chipnet');
async function balances() {
  const scan: [string, number][] = [...[...Array(10).keys()].map((i): [string, number] => ['receive', i]), ...[...Array(5).keys()].map((i): [string, number] => ['change', i])];
  const sats = await Promise.all(scan.map(async ([path, i]) => (await net.getUtxos(addr(path, i))).reduce((s, u) => s + u.satoshis, 0n)));
  const rows = scan.map(([path, i], k) => ({ path, i, sats: sats[k] }))
    .filter((r) => r.sats > 0n || (r.path === 'receive' && r.i === 0))
    .map((r) => `  ${r.path}/${r.i} ${addr(r.path, r.i)} ${r.sats} sats`);
  return { rows, total: sats.reduce((a, b) => a + b, 0n) };
}
{
  const { rows, total } = await balances();
  say(`balance across receive/0-9 + change/0-4 (what the dapp scans): ${total} sats`);
  rows.forEach((r) => process.stdout.write(r + '\n'));
  if (args.includes('--drip')) {
    const r = await fetch(`${API}/faucet/drip`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address: receive0 }), signal: AbortSignal.timeout(60_000) });
    say(`faucet ${r.status}: ${await r.text()}`);
  } else if (total === 0n) {
    say(`fund it: rerun with --drip (hosted faucet), or send chipnet coins to ${receive0}`);
  }
}
if (!uri) {
  if (!args.includes('--drip')) say('no wiz:// URI given; pass the URI from the dapp\'s WizardConnect dialog to connect.');
  await net.disconnect?.().catch(() => {});
  process.exit(0);
}

// ---------- WizardConnect (wallet side of hdwalletv1) ----------
const decoded = decodeKeyExchangeURI(uri);
say(`pairing with dapp ${decoded.publicKey.slice(0, 16)}… via ${decoded.protocol}://${decoded.hostname}:${decoded.port}`);
// One stable relay identity per URI (protocol requirement), derived from the seed and the URI.
const walletPrivateKey = sha256.hash(utf8ToBin(`wc-test-wallet|${stored.mnemonic}|${uri}`));

let client: RelayClient | null = null;
let listening = false;
let dappDiscovered = false;
let dappName = '';
const now = () => Math.floor(Date.now() / 1000);
const send = async (msg: Record<string, unknown>) => {
  record('out', msg);
  await client!.relay(msg as never);
};

const relay = initiateWalletRelay((payload) => {
  const status = payload.status.status;
  say(`relay: ${status}${payload.status.error ? ` (${payload.status.error})` : ''}`);
  if (status !== 'connected') return;
  client = payload.client;
  if (!listening) { listening = true; client.on('message', (m: any) => onMessage(m).catch((e) => say('handler error:', (e as Error).message))); }
  dappDiscovered = false; // new connection cycle (protocol rule 4)
  sendWalletReady().catch((e) => say('wallet_ready failed:', (e as Error).message));
}, { uri, walletPrivateKey });

async function sendWalletReady() {
  await send({
    action: RelayMsgAction.WalletReady,
    time: now(),
    wallet_name: 'AgentTab headless test wallet (chipnet)',
    wallet_icon: '',
    dapp_discovered: dappDiscovered,
    supported_protocols: [PROTOCOL_NAME],
    session: { [PROTOCOL_NAME]: { paths: wallet.paths } },
    public_key: binToHex(relay.walletPublicKey),
    secret: relay.secret,
    extensions: { chunk: chunkExtensionAdvertisement() },
  });
  say(`-> wallet_ready (dapp_discovered=${dappDiscovered}); shared xpubs for ${wallet.paths.map((p) => p.name).join('/')}`);
}

const outAddress = (lb: Uint8Array) => {
  const r = lockingBytecodeToCashAddress({ bytecode: lb, prefix: 'bchtest' });
  return typeof r === 'string' ? `script:${binToHex(lb).slice(0, 24)}…` : r.address;
};

async function onMessage(msg: any) {
  record('in', msg);
  switch (msg.action) {
    case RelayMsgAction.DappReady: {
      if (msg.dapp_name) dappName = msg.dapp_name;
      client?.setPeerCapabilities({ chunk: peerSupportsChunk(msg.extensions) });
      say(`<- dapp_ready from "${dappName}" wallet_discovered=${msg.wallet_discovered}${msg.selected_protocol ? ` selected=${msg.selected_protocol}` : ''}`);
      if (!msg.wallet_discovered) { dappDiscovered = true; await sendWalletReady(); }
      else { if (!dappDiscovered) say(`PAIRED with "${dappName}". The dapp now shows ${receive0}. Waiting for sign requests…`); dappDiscovered = true; }
      return;
    }
    case RelayMsgAction.Ping:
      await send({ action: RelayMsgAction.Pong, time: now() });
      if (verbose) say('<- ping -> pong');
      return;
    case RelayMsgAction.SignCancel:
      say(`<- sign_cancel seq=${msg.sequence} reason=${msg.reason ?? ''}`);
      return;
    case RelayMsgAction.Disconnect:
      say(`<- disconnect reason=${msg.reason} ${msg.message ?? ''}`);
      return;
    case RelayMsgAction.SignTransactionRequest:
      return onSign(msg);
    default:
      say(`<- ${msg.action} (ignored)`);
  }
}

async function onSign(msg: any) {
  if (!isSignTransactionRequest(msg)) { say('<- malformed sign_transaction_request', JSON.stringify(msg).slice(0, 300)); return; }
  say(`<- sign_transaction_request seq=${msg.sequence} inputPaths=${JSON.stringify(msg.inputPaths)}`);
  try {
    const { transaction, sourceOutputs, userPrompt, broadcast } = decodeWcTransaction(msg.transaction);
    say(`   prompt: "${userPrompt ?? ''}"  broadcast=${broadcast ?? false}  locktime=${transaction.locktime}`);
    sourceOutputs.forEach((so, i) => say(`   in ${i}: ${outAddress(so.lockingBytecode)} ${so.valueSatoshis} sats${so.contract ? ` (contract ${so.contract.abiFunction?.name ?? ''})` : ''}`));
    transaction.outputs.forEach((o, i) => say(`   out ${i}: ${outAddress(o.lockingBytecode)} ${o.valueSatoshis} sats`));
    const r = signWcRequest(msg.transaction, msg.inputPaths, wallet.key);
    r.notes.forEach((n) => say(`   ${n}`));
    say(`   VM verify: ${r.vmVerify === true ? 'OK' : `FAILED ${r.vmVerify}`}`);
    await send({ action: RelayMsgAction.SignTransactionResponse, time: now(), sequence: msg.sequence, signedTransaction: r.hex });
    say(`-> sign_transaction_response seq=${msg.sequence} txid=${r.txid} (${r.hex.length / 2} bytes). The dapp broadcasts it: https://chipnet.imaginary.cash/tx/${r.txid}`);
  } catch (e) {
    const error = (e as Error).message;
    say(`   signing failed: ${error}`);
    await send({ action: RelayMsgAction.SignTransactionResponse, time: now(), sequence: msg.sequence, signedTransaction: '', error });
    say(`-> sign_transaction_response seq=${msg.sequence} error="${error}"`);
  }
}

process.on('SIGINT', async () => {
  say('disconnecting…');
  try { if (client) await Promise.race([send({ action: RelayMsgAction.Disconnect, reason: 'user_disconnect', time: now() }), new Promise((r) => setTimeout(r, 3000))]); } catch { /* best effort */ }
  relay.cleanup();
  process.exit(0);
});
say(`log of every message: ${logFile.pathname}  (Ctrl+C to quit)`);
