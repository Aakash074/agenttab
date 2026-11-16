// AgentTab SDK: open a tab, sign/verify cumulative vouchers, settle, refund.
import {
  Contract,
  ElectrumNetworkProvider,
  SignatureTemplate,
  TransactionBuilder,
  type NetworkProvider,
  type Unlocker,
  type SpendableUtxo as Utxo,
} from 'cashscript';
import {
  bigIntToBinUint64LE,
  binToHex,
  encodeCashAddress,
  hash160,
  hexToBin,
  numberToBinUint32LE,
  secp256k1,
  sha256,
} from '@bitauth/libauth';
import artifactJson from '../contracts/AgentTab.json' with { type: 'json' };

export const artifact = artifactJson;

/** Network dust limit for P2PKH outputs. */
export const DUST = 546n;
/** "AGENTTAB" domain tag prefixed to every voucher message. */
export const VOUCHER_DOMAIN = hexToBin('4147454e54544142');
/** Default fee rate, sat/byte (BCH min relay = 1). */
export const FEE_RATE = 1n;

export type Network = 'mainnet' | 'chipnet' | 'mocknet';

/**
 * Faster blocks (CHIP-2025-03) keep height-based nLockTime / OP_CHECKLOCKTIMEVERIFY in idealized
 * 10-minute units: after activation height A with 1-minute blocks, a block at height h counts as
 * lock height A + floor((h - A) / 10). Raw block height and lock height diverge, so a tab `timeout`
 * (the covenant's `tx.time >= timeout`, enforced through nLockTime) must be compared with the LOCK
 * height, never with the raw tip.
 * Chipnet activated it on 2026-11-15. A = 332451 was measured against two chipnet nodes
 * (imaginary.cash, bch.ninja) by bisecting the highest nLockTime they accept as final at several tips;
 * mainnet has not activated it.
 */
export const FAST_BLOCKS: Partial<Record<Network, { height: number; factor: number }>> = {
  chipnet: { height: 332_451, factor: 10 },
};

/** The nLockTime-unit height of the block at raw height `height`. */
export function lockHeightAt(height: number, network: Network): number {
  const fb = FAST_BLOCKS[network];
  return !fb || height <= fb.height ? height : fb.height + Math.floor((height - fb.height) / fb.factor);
}

/**
 * The "lock tip": the largest height-based nLockTime that is final for the next block, so a tx with
 * nLockTime <= lockTip(tip) is accepted now. Equals the raw tip before faster blocks. Use it wherever
 * code used `tip` against a tab timeout (refund unlocked iff lockTip >= timeout; new timeout = lockTip + n).
 */
export function lockTip(tip: number, network: Network): number {
  return lockHeightAt(tip + 1, network) - 1;
}

/** Current lock tip from a provider (see lockTip). */
export async function chainLockTip(provider: NetworkProvider, network: Network): Promise<number> {
  return lockTip(await provider.getBlockHeight(), network);
}

export interface Outpoint {
  txid: string; // display (big-endian) hex
  vout: number;
}

export interface TabParams {
  /** Funds the tab, receives the remainder, can refund after timeout (human wallet or the agent). */
  ownerPub: Uint8Array;
  /** Signs spending vouchers only; can never withdraw. */
  agentPub: Uint8Array;
  providerPub: Uint8Array;
  /** Absolute nLockTime: block height (< 500M) or unix seconds (>= 500M), compared against MTP. */
  timeout: bigint;
}

export interface Voucher {
  outpoint: Outpoint;
  amount: bigint; // cumulative satoshis owed
  sig: string; // hex schnorr datasig by agent
}

export const toBin = (x: Uint8Array | string) => (typeof x === 'string' ? hexToBin(x) : x);

export function pubFromPriv(priv: Uint8Array): Uint8Array {
  const pub = secp256k1.derivePublicKeyCompressed(priv);
  if (typeof pub === 'string') throw new Error(pub);
  return pub;
}

export function p2pkhAddress(pub: Uint8Array, network: Network = 'chipnet'): string {
  const prefix = network === 'mainnet' ? 'bitcoincash' : 'bchtest';
  return encodeCashAddress({ prefix, type: 'p2pkh', payload: hash160(pub) }).address;
}

export function tabContract(p: TabParams, provider: NetworkProvider): Contract {
  return new Contract(artifact, [p.ownerPub, p.agentPub, p.providerPub, p.timeout], { provider, contractType: 'p2sh32' });
}

/** Exactly the bytes the covenant feeds to OP_CHECKDATASIG. */
export function voucherMessage(outpoint: Outpoint, amount: bigint): Uint8Array {
  if (amount < 0n) throw new Error('negative amount');
  // OP_OUTPOINTTXHASH yields the hash in internal (little-endian) byte order.
  const txHashLE = hexToBin(outpoint.txid).reverse();
  return Uint8Array.from([
    ...VOUCHER_DOMAIN,
    ...txHashLE,
    ...numberToBinUint32LE(outpoint.vout),
    ...bigIntToBinUint64LE(amount),
  ]);
}

export function signVoucher(agentPriv: Uint8Array, outpoint: Outpoint, amount: bigint): Voucher {
  const sig = secp256k1.signMessageHashSchnorr(agentPriv, sha256.hash(voucherMessage(outpoint, amount)));
  if (typeof sig === 'string') throw new Error(sig);
  return { outpoint, amount, sig: binToHex(sig) };
}

export function verifyVoucher(agentPub: Uint8Array, v: Voucher): boolean {
  try {
    return secp256k1.verifySignatureSchnorr(
      hexToBin(v.sig),
      agentPub,
      sha256.hash(voucherMessage(v.outpoint, v.amount)),
    );
  } catch {
    return false;
  }
}

/** Largest voucher the covenant can ever settle for a given budget. */
export const maxSpendable = (budget: bigint) => budget - DUST;

/** Builds a tx twice: once with a placeholder fee to measure size, then with the real fee.
 *  Works with wallet placeholder unlockers too (size counted as if signed). */
function withFee(build: (fee: bigint) => TransactionBuilder, rate = FEE_RATE): TransactionBuilder {
  // Probe with a zero fee so small outputs (e.g. a provider share near dust) don't fail the probe.
  const size = build(0n).getTransactionSize();
  return build((size + 2n) * rate);
}

/** Funds a new tab from plain P2PKH utxos. Pass `payerPriv` to sign locally, or `unlocker`
 *  (e.g. cashscript's placeholderP2PKHUnlocker(address)) to have a wallet sign it via
 *  WizardConnect/WalletConnect (`builder.generateWcTransactionObject()`). */
export function buildOpen(opts: {
  provider: NetworkProvider;
  contract: Contract;
  payerPriv?: Uint8Array;
  unlocker?: Unlocker;
  /** Per-utxo unlocker, e.g. when a wallet's utxos sit on several addresses. */
  unlockerFor?: (u: Utxo) => Unlocker;
  fundingUtxos: Utxo[];
  budget: bigint;
  changeAddress: string;
}): TransactionBuilder {
  const { provider, contract, fundingUtxos, budget, changeAddress } = opts;
  if (budget < 2n * DUST) throw new Error(`budget must be >= ${2n * DUST} sats`);
  const total = fundingUtxos.filter((u) => !u.token).reduce((s, u) => s + u.satoshis, 0n);
  const unlockerFor = opts.unlockerFor
    ?? (() => { const u = opts.unlocker ?? new SignatureTemplate(opts.payerPriv!).unlockP2PKH(); return () => u; })();
  const spendable = fundingUtxos.filter((u) => !u.token);
  return withFee((fee) => {
    const change = total - budget - fee;
    if (change < 0n) throw new Error(`insufficient funds: have ${total}, need ${budget + fee}`);
    const b = new TransactionBuilder({ provider })
      .addInputs(spendable.map((u) => ({ ...u, unlocker: unlockerFor(u) })))
      .addOutput({ to: contract.address, amount: budget });
    if (change >= DUST) b.addOutput({ to: changeAddress, amount: change });
    return b;
  });
}

/** OP_RETURN tag carried by a direct (pay-once) payment: OP_RETURN <"AGENTTAB"> <invoiceId>. */
export const DIRECT_TAG = 'AGENTTAB';

/**
 * Plain pay-once payment (no covenant): `amount` sats to `payTo` plus an OP_RETURN binding the tx to
 * one invoice, change back to `changeAddress`. Picks the largest utxos first. Sign locally with
 * `payerPriv`, or pass `unlockerFor` (placeholder P2PKH unlockers) to have a wallet sign it.
 */
export function buildDirectPay(opts: {
  provider: NetworkProvider;
  payTo: string;
  amount: bigint;
  invoiceId: string;
  fundingUtxos: Utxo[];
  changeAddress: string;
  payerPriv?: Uint8Array;
  unlockerFor?: (u: Utxo) => Unlocker;
}): { builder: TransactionBuilder; inputs: Utxo[] } {
  const { provider, payTo, amount, invoiceId, changeAddress } = opts;
  if (amount < DUST) throw new Error(`amount must be >= ${DUST} sats`);
  if (!/^[0-9a-z]{8,64}$/i.test(invoiceId)) throw new Error('bad invoice id');
  const unlockerFor = opts.unlockerFor
    ?? (() => { const u = new SignatureTemplate(opts.payerPriv!).unlockP2PKH(); return () => u; })();
  const sorted = opts.fundingUtxos.filter((u) => !u.token).sort((a, b) => (b.satoshis > a.satoshis ? 1 : b.satoshis < a.satoshis ? -1 : 0));
  const inputs: Utxo[] = [];
  let total = 0n;
  // ~150 bytes per P2PKH input + ~120 bytes of outputs/overhead, at 1 sat/byte, plus room for change.
  for (const u of sorted) {
    if (total >= amount + 300n + 150n * BigInt(inputs.length) + DUST) break;
    inputs.push(u);
    total += u.satoshis;
  }
  const builder = withFee((fee) => {
    const change = total - amount - fee;
    if (change < 0n) throw new Error(`insufficient funds: have ${total}, need ${amount + fee}`);
    const b = new TransactionBuilder({ provider })
      .addInputs(inputs.map((u) => ({ ...u, unlocker: unlockerFor(u) })))
      .addOutput({ to: payTo, amount })
      .addOpReturnOutput([DIRECT_TAG, invoiceId]);
    if (change >= DUST) b.addOutput({ to: changeAddress, amount: change });
    return b;
  });
  return { builder, inputs };
}

/** Provider settles the tab with the agent's highest voucher. Fee is paid from the provider's share. */
export function buildSettle(opts: {
  provider: NetworkProvider;
  contract: Contract;
  tabUtxo: Utxo;
  providerPriv: Uint8Array;
  ownerPub: Uint8Array;
  voucher: Voucher;
  network?: Network;
}): TransactionBuilder {
  const { provider, contract, tabUtxo, providerPriv, ownerPub, voucher, network = 'chipnet' } = opts;
  if (tabUtxo.txid !== voucher.outpoint.txid || tabUtxo.vout !== voucher.outpoint.vout) {
    throw new Error('voucher is for a different tab outpoint');
  }
  const providerPub = pubFromPriv(providerPriv);
  const remainder = tabUtxo.satoshis - voucher.amount;
  return withFee((fee) =>
    new TransactionBuilder({ provider })
      .addInput(
        tabUtxo,
        contract.unlock.settle(
          new SignatureTemplate(providerPriv),
          hexToBin(voucher.sig),
          bigIntToBinUint64LE(voucher.amount),
        ),
      )
      .addOutput({ to: p2pkhAddress(providerPub, network), amount: voucher.amount - fee })
      .addOutput({ to: p2pkhAddress(ownerPub, network), amount: remainder }),
  );
}

/** Provider waives the tab: the whole budget (minus the miner fee, capped at 1000 sats by the covenant) goes back to the owner. */
export function buildCancel(opts: {
  provider: NetworkProvider;
  contract: Contract;
  tabUtxo: Utxo;
  providerPriv: Uint8Array;
  ownerPub: Uint8Array;
  network?: Network;
}): TransactionBuilder {
  const { provider, contract, tabUtxo, providerPriv, ownerPub, network = 'chipnet' } = opts;
  return withFee((fee) =>
    new TransactionBuilder({ provider })
      .addInput(tabUtxo, contract.unlock.cancel(new SignatureTemplate(providerPriv)))
      .addOutput({ to: p2pkhAddress(ownerPub, network), amount: tabUtxo.satoshis - fee }),
  );
}

/** Owner reclaims the whole tab after the timeout. Pass `ownerPriv`, or `ownerSig` =
 *  placeholderSignature() + `to` for wallet signing. */
export function buildRefund(opts: {
  provider: NetworkProvider;
  contract: Contract;
  tabUtxo: Utxo;
  ownerPriv?: Uint8Array;
  ownerSig?: Uint8Array;
  timeout: bigint;
  to?: string;
  network?: Network;
}): TransactionBuilder {
  const { provider, contract, tabUtxo, ownerPriv, timeout, network = 'chipnet' } = opts;
  const to = opts.to ?? p2pkhAddress(pubFromPriv(ownerPriv!), network);
  const sig = opts.ownerSig ?? new SignatureTemplate(ownerPriv!);
  return withFee((fee) =>
    new TransactionBuilder({ provider })
      .addInput(tabUtxo, contract.unlock.refund(sig))
      .addOutput({ to, amount: tabUtxo.satoshis - fee })
      .setLocktime(Number(timeout)),
  );
}

/**
 * Electrum provider that reads from one server and mirrors every broadcast to others.
 * Why: on 2026-11-14 the default chipnet server's node (chipnet.bch.ninja) accepted our txs into its own
 * mempool but never relayed them, so nothing confirmed for hours. Broadcasting to several independent
 * nodes avoids depending on one node's peers.
 */
export class MirroredElectrumProvider extends ElectrumNetworkProvider {
  private mirrors: ElectrumNetworkProvider[];
  constructor(network: 'chipnet' | 'mainnet', hostname: string, mirrorHosts: string[]) {
    super(network, { hostname });
    this.mirrors = mirrorHosts.map((h) => new ElectrumNetworkProvider(network, { hostname: h }));
  }
  override async sendRawTransaction(txHex: string): Promise<string> {
    const txid = await super.sendRawTransaction(txHex);
    for (const m of this.mirrors) m.sendRawTransaction(txHex).catch(() => { /* best effort */ });
    return txid;
  }
}

/** Default provider per network (chipnet: read from imaginary.cash, mirror broadcasts to bch.ninja). */
export function electrumProvider(network: 'chipnet' | 'mainnet'): ElectrumNetworkProvider {
  return network === 'chipnet'
    ? new MirroredElectrumProvider('chipnet', 'chipnet.imaginary.cash', ['chipnet.bch.ninja'])
    : new ElectrumNetworkProvider('mainnet');
}

export { binToHex, hexToBin };
