// AgentTab SDK: open a tab, sign/verify cumulative vouchers, settle, refund.
import {
  Contract,
  SignatureTemplate,
  TransactionBuilder,
  type NetworkProvider,
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
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
export const artifact = require('../contracts/AgentTab.json');

/** Network dust limit for P2PKH outputs. */
export const DUST = 546n;
/** "AGENTTAB" domain tag prefixed to every voucher message. */
export const VOUCHER_DOMAIN = hexToBin('4147454e54544142');
/** Default fee rate, sat/byte (BCH min relay = 1). */
export const FEE_RATE = 1n;

export type Network = 'mainnet' | 'chipnet' | 'mocknet';

export interface Outpoint {
  txid: string; // display (big-endian) hex
  vout: number;
}

export interface TabParams {
  ownerPub: Uint8Array;
  providerPub: Uint8Array;
  /** Absolute nLockTime: block height (< 500M) or unix seconds (>= 500M), compared against MTP. */
  timeout: bigint;
}

export interface Voucher {
  outpoint: Outpoint;
  amount: bigint; // cumulative satoshis owed
  sig: string; // hex schnorr datasig by owner
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
  return new Contract(artifact, [p.ownerPub, p.providerPub, p.timeout], { provider, contractType: 'p2sh32' });
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

export function signVoucher(ownerPriv: Uint8Array, outpoint: Outpoint, amount: bigint): Voucher {
  const sig = secp256k1.signMessageHashSchnorr(ownerPriv, sha256.hash(voucherMessage(outpoint, amount)));
  if (typeof sig === 'string') throw new Error(sig);
  return { outpoint, amount, sig: binToHex(sig) };
}

export function verifyVoucher(ownerPub: Uint8Array, v: Voucher): boolean {
  try {
    return secp256k1.verifySignatureSchnorr(
      hexToBin(v.sig),
      ownerPub,
      sha256.hash(voucherMessage(v.outpoint, v.amount)),
    );
  } catch {
    return false;
  }
}

/** Largest voucher the covenant can ever settle for a given budget. */
export const maxSpendable = (budget: bigint) => budget - DUST;

/** Builds a tx twice: once with a placeholder fee to measure size, then with the real fee. */
function withFee(build: (fee: bigint) => TransactionBuilder, rate = FEE_RATE): TransactionBuilder {
  const probe = build(1000n).build();
  const fee = (BigInt(probe.length / 2) + 2n) * rate;
  return build(fee);
}

/** Owner funds a new tab from plain P2PKH utxos. Returns the builder (call .send()). */
export function buildOpen(opts: {
  provider: NetworkProvider;
  contract: Contract;
  ownerPriv: Uint8Array;
  fundingUtxos: Utxo[];
  budget: bigint;
  changeAddress: string;
}): TransactionBuilder {
  const { provider, contract, ownerPriv, fundingUtxos, budget, changeAddress } = opts;
  if (budget < 2n * DUST) throw new Error(`budget must be >= ${2n * DUST} sats`);
  const total = fundingUtxos.reduce((s, u) => s + u.satoshis, 0n);
  const signer = new SignatureTemplate(ownerPriv);
  return withFee((fee) => {
    const change = total - budget - fee;
    if (change < 0n) throw new Error(`insufficient funds: have ${total}, need ${budget + fee}`);
    const b = new TransactionBuilder({ provider })
      .addInputs(fundingUtxos, signer.unlockP2PKH())
      .addOutput({ to: contract.address, amount: budget });
    if (change >= DUST) b.addOutput({ to: changeAddress, amount: change });
    return b;
  });
}

/** Provider settles the tab with the owner's highest voucher. Fee is paid from the provider's share. */
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

/** Owner reclaims the whole tab after the timeout. */
export function buildRefund(opts: {
  provider: NetworkProvider;
  contract: Contract;
  tabUtxo: Utxo;
  ownerPriv: Uint8Array;
  timeout: bigint;
  to?: string;
  network?: Network;
}): TransactionBuilder {
  const { provider, contract, tabUtxo, ownerPriv, timeout, network = 'chipnet' } = opts;
  const to = opts.to ?? p2pkhAddress(pubFromPriv(ownerPriv), network);
  return withFee((fee) =>
    new TransactionBuilder({ provider })
      .addInput(tabUtxo, contract.unlock.refund(new SignatureTemplate(ownerPriv)))
      .addOutput({ to, amount: tabUtxo.satoshis - fee })
      .setLocktime(Number(timeout)),
  );
}

export { binToHex, hexToBin };
