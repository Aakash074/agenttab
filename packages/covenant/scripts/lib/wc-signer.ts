// Wallet-side signing for WizardConnect (hdwalletv1) sign_transaction_request messages, written the
// way a BCH WalletConnect-style wallet (e.g. Paytaca) signs:
//  - every input listed in `inputPaths` is signed with the HD key at [pathName, addressIndex];
//  - an input with EMPTY unlocking bytecode is P2PKH: unlocking = <sig> <pubkey>;
//  - an input with unlocking bytecode already set is a contract input: its zero-filled 65-byte
//    placeholder signature (cashscript placeholderSignature()) and 33-byte placeholder pubkey
//    (placeholderPublicKey()) pushes are replaced with the real ones. The covered bytecode is the
//    redeem script (sourceOutputs[i].contract.redeemScript, else the last push of the unlocking bytecode).
//  - sighash = ALL | FORKID | UTXOS (0x61), the only type WizardConnect wallets may use.
// CHIPNET test tooling only. No network access here.
import {
  binToHex, createVirtualMachineBch, decodeAuthenticationInstructions, decodeTransaction, deriveHdPath,
  deriveHdPrivateNodeChild, deriveHdPrivateNodeFromBip39Mnemonic, deriveHdPublicNode, encodeAuthenticationInstructions, encodeDataPush,
  encodeHdPublicKey, encodeTransaction, generateSigningSerializationBch, hash160, hash256, hexToBin,
  secp256k1, type HdPrivateNodeValid, type Input, type Output, type Transaction,
} from '@bitauth/libauth';

export const SIGHASH_ALL_FORKID_UTXOS = 0x61;
const PATH_CHILD: Record<string, number> = { receive: 0, change: 1, defi: 7 };

// ---------- HD wallet (BIP44 m/44'/145'/0'/{0,1,7}/i) ----------
export interface HdWallet {
  key(path: string, index: number): { priv: Uint8Array; pub: Uint8Array };
  /** Chain-level xpub (one level below the account), as WizardConnect wallets share it. */
  xpub(path: string): string;
  paths: { name: string; xpub: string }[];
}

export function hdWallet(mnemonic: string): HdWallet {
  const master = deriveHdPrivateNodeFromBip39Mnemonic(mnemonic);
  if (typeof master === 'string') throw new Error(master);
  const chains = new Map<string, HdPrivateNodeValid>();
  const chain = (name: string) => {
    const child = PATH_CHILD[name];
    if (child === undefined) throw new Error(`unknown HD path name "${name}"`);
    let node = chains.get(name);
    if (!node) {
      const d = deriveHdPath(master, `m/44'/145'/0'/${child}`);
      if (typeof d === 'string') throw new Error(d);
      node = d as HdPrivateNodeValid;
      chains.set(name, node);
    }
    return node;
  };
  const key = (path: string, index: number) => {
    const d = deriveHdPrivateNodeChild(chain(path), index);
    if (typeof d === 'string') throw new Error(d);
    const priv = d.privateKey;
    const pub = secp256k1.derivePublicKeyCompressed(priv);
    if (typeof pub === 'string') throw new Error(pub);
    return { priv, pub };
  };
  const xpub = (path: string) => {
    const r = encodeHdPublicKey({ node: deriveHdPublicNode(chain(path)), network: 'testnet' });
    if (typeof r === 'string') throw new Error(r);
    return r.hdPublicKey;
  };
  return { key, xpub, paths: Object.keys(PATH_CHILD).map((name) => ({ name, xpub: xpub(name) })) };
}

// ---------- relay decoding ----------
// The relay carries JSON. Bytes arrive as hex or "<Uint8Array: 0x..>", bigints as "<bigint: Nn>",
// numeric strings or numbers (see @wizardconnect/core docs/serialization.md).
const bytes = (v: unknown): Uint8Array => {
  if (v instanceof Uint8Array) return v;
  if (typeof v === 'string') {
    const m = v.match(/^<Uint8Array: 0x([0-9a-f]*)>$/i);
    return hexToBin(m ? m[1] : v);
  }
  if (v && typeof v === 'object') return Uint8Array.from(Object.values(v as Record<string, number>)); // JSON of a Uint8Array
  throw new Error(`expected bytes, got ${JSON.stringify(v)}`);
};
const big = (v: unknown): bigint => {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') return BigInt(v);
  if (typeof v === 'string') {
    const m = v.match(/^<bigint: (-?\d+)n>$/);
    return BigInt(m ? m[1] : v);
  }
  throw new Error(`expected bigint, got ${JSON.stringify(v)}`);
};
const token = (t: any) => t && ({
  category: bytes(t.category),
  amount: big(t.amount ?? 0),
  ...(t.nft ? { nft: { capability: t.nft.capability ?? 'none', commitment: bytes(t.nft.commitment ?? '') } } : {}),
});

export interface SourceOutputLike extends Input, Output { contract?: { redeemScript?: Uint8Array; abiFunction?: { name: string } } }

export function decodeWcTransaction(wc: any): { transaction: Transaction; sourceOutputs: SourceOutputLike[]; userPrompt?: string; broadcast?: boolean } {
  if (!wc || typeof wc !== 'object') throw new Error('transaction field missing');
  let transaction: Transaction;
  if (typeof wc.transaction === 'string') {
    const t = decodeTransaction(bytes(wc.transaction));
    if (typeof t === 'string') throw new Error(`bad transaction hex: ${t}`);
    transaction = t;
  } else {
    const t = wc.transaction;
    transaction = {
      version: Number(t.version),
      locktime: Number(t.locktime),
      inputs: t.inputs.map((i: any) => ({
        outpointTransactionHash: bytes(i.outpointTransactionHash), outpointIndex: Number(i.outpointIndex),
        sequenceNumber: Number(i.sequenceNumber), unlockingBytecode: bytes(i.unlockingBytecode ?? ''),
      })),
      outputs: t.outputs.map((o: any) => ({
        lockingBytecode: bytes(o.lockingBytecode), valueSatoshis: big(o.valueSatoshis), ...(o.token ? { token: token(o.token) } : {}),
      })),
    };
  }
  const sourceOutputs: SourceOutputLike[] = (wc.sourceOutputs ?? []).map((s: any, i: number) => ({
    outpointTransactionHash: bytes(s.outpointTransactionHash ?? transaction.inputs[i].outpointTransactionHash),
    outpointIndex: Number(s.outpointIndex ?? transaction.inputs[i].outpointIndex),
    sequenceNumber: Number(s.sequenceNumber ?? transaction.inputs[i].sequenceNumber),
    unlockingBytecode: bytes(s.unlockingBytecode ?? transaction.inputs[i].unlockingBytecode),
    lockingBytecode: bytes(s.lockingBytecode),
    valueSatoshis: big(s.valueSatoshis),
    ...(s.token ? { token: token(s.token) } : {}),
    ...(s.contract ? { contract: { ...s.contract, ...(s.contract.redeemScript ? { redeemScript: bytes(s.contract.redeemScript) } : {}) } } : {}),
  }));
  if (sourceOutputs.length !== transaction.inputs.length) throw new Error(`sourceOutputs (${sourceOutputs.length}) != inputs (${transaction.inputs.length})`);
  return { transaction, sourceOutputs, userPrompt: wc.userPrompt, broadcast: wc.broadcast };
}

// ---------- signing ----------
const isZero = (b: Uint8Array, len: number) => b.length === len && b.every((x) => x === 0);

export interface SignResult { hex: string; txid: string; notes: string[]; vmVerify: true | string }

export function signWcRequest(
  wc: unknown,
  inputPaths: [number, string, number][],
  keyAt: (path: string, index: number) => { priv: Uint8Array; pub: Uint8Array },
): SignResult {
  const { transaction, sourceOutputs } = decodeWcTransaction(wc);
  const notes: string[] = [];
  const signed = transaction.inputs.map((i) => ({ ...i }));
  const sighashType = new Uint8Array([SIGHASH_ALL_FORKID_UTXOS]);
  // The VM's signing serialization reads only (outpoint, sequence) of inputs plus the source outputs.
  const context = { inputIndex: 0, transaction, sourceOutputs };

  for (const [idx, path, addrIndex] of inputPaths) {
    const input = transaction.inputs[idx];
    const so = sourceOutputs[idx];
    if (!input || !so) throw new Error(`inputPaths references missing input ${idx}`);
    const { priv, pub } = keyAt(path, addrIndex);
    const isContract = input.unlockingBytecode.length > 0;
    let covered: Uint8Array;
    if (isContract) {
      const instrs = decodeAuthenticationInstructions(input.unlockingBytecode) as any[];
      covered = so.contract?.redeemScript ?? instrs[instrs.length - 1]?.data;
      if (!covered) throw new Error(`input ${idx}: cannot find redeem script`);
    } else {
      covered = so.lockingBytecode;
      const expected = Uint8Array.from([0x76, 0xa9, 0x14, ...hash160(pub), 0x88, 0xac]);
      if (binToHex(expected) !== binToHex(so.lockingBytecode)) notes.push(`input ${idx}: key ${path}/${addrIndex} does NOT match the P2PKH locking bytecode (signing anyway; tx will be invalid)`);
    }
    const preimage = generateSigningSerializationBch({ ...context, inputIndex: idx }, { coveredBytecode: covered, signingSerializationType: sighashType });
    const sig = secp256k1.signMessageHashSchnorr(priv, hash256(preimage));
    if (typeof sig === 'string') throw new Error(sig);
    const fullSig = Uint8Array.from([...sig, SIGHASH_ALL_FORKID_UTXOS]);
    if (!isContract) {
      signed[idx].unlockingBytecode = Uint8Array.from([...encodeDataPush(fullSig), ...encodeDataPush(pub)]);
      notes.push(`input ${idx}: P2PKH signed with ${path}/${addrIndex}`);
    } else {
      const instrs = decodeAuthenticationInstructions(input.unlockingBytecode) as any[];
      let sigs = 0, pubs = 0;
      const replaced = instrs.map((ins) => {
        if (ins.data && isZero(ins.data, 65)) { sigs++; return { ...ins, data: fullSig }; }
        if (ins.data && isZero(ins.data, 33)) { pubs++; return { ...ins, data: pub }; }
        return ins;
      });
      if (!sigs) notes.push(`input ${idx}: contract input has no 65-byte placeholder signature to replace`);
      signed[idx].unlockingBytecode = encodeAuthenticationInstructions(replaced);
      notes.push(`input ${idx}: contract (${so.contract?.abiFunction?.name ?? 'p2sh'}) signed with ${path}/${addrIndex}, replaced ${sigs} placeholder sig(s), ${pubs} placeholder pubkey(s)`);
    }
  }
  const finalTx: Transaction = { ...transaction, inputs: signed };
  const encoded = encodeTransaction(finalTx);
  const vm = createVirtualMachineBch(true);
  const verdict = vm.verify({ transaction: finalTx, sourceOutputs });
  const txid = binToHex(hash256(encoded).reverse());
  return { hex: binToHex(encoded), txid, notes, vmVerify: verdict === true ? true : String(verdict) };
}
