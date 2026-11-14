# Chipnet proof: AgentTab covenant end to end

**Network:** chipnet (BCH testnet). All keys are throwaway chipnet keys generated locally; they are in `.env`, which is gitignored. The test coins came free from the BCH Ninja proof-of-work faucet (https://chipnet.bch.ninja) in faucet tx `76822cfc12b376c30bee097fa74b893f3a5f6c46477449fbf2a3c3c1f166140a`.

**Run date:** 2026-11-14 14:07–14:15 UTC (build window opened 14:00 UTC). The tip was at height 332318–332319.

- Owner (agent) address: `bchtest:qzxawz6qwku8xguf7vsdxwx6cjzrg8mxzq0q2qqc5m`
- Provider address: `bchtest:qzhyn0j9r7e5rsnkae4a5dej3nhtgn4f8vqj3v8xcc`
- Contract: `packages/covenant/contracts/AgentTab.cash`. It compiles to 126 bytes and is deployed as P2SH32.

Explorers:
- `https://chipnet.imaginary.cash/tx/<txid>`
- `https://explorer.selene.cash/tx/<txid>?network=chipnet`

## 1. Tab A: open, 3 cumulative vouchers, settle

The script is `packages/covenant/scripts/chipnet-demo.ts`. Tab A has budget 20,000 sats, a price of 1,000 sats per call, and timeout at height 333318. Its contract address is `bchtest:pwc53xf8vnwmm45zzlkhvnwx8uh8rn2ukwvswpsssh4z723mzvd26w9lng8dv`.

| Step | Txid | Link |
|---|---|---|
| Open (owner locks 20,000 sats) | `d424928d18b4806c8551add7b97ec5706e8cdb0c9f6f0be425beab267926b498` | [view](https://chipnet.imaginary.cash/tx/d424928d18b4806c8551add7b97ec5706e8cdb0c9f6f0be425beab267926b498) |
| Vouchers #1, #2, #3 (1000, 2000, 3000 sats; off-chain, Schnorr datasig) | none (off-chain) | |
| Overclaim attempt (a 9000-sat claim with the 3000-sat voucher) | **rejected** at `AgentTab.cash:26` (checkDataSig) | |
| **Settle** (provider gets 3000 sats minus fee; owner gets exactly 17,000) | `6f14f00fc1a4bc9c480038df08fe6c953d5d86cd018f4c2a09cfd73cbf10c8ed` | [view](https://chipnet.imaginary.cash/tx/6f14f00fc1a4bc9c480038df08fe6c953d5d86cd018f4c2a09cfd73cbf10c8ed) |

## 2. Tab B: refund after timeout

Tab B has budget 10,000 sats and timeout at block height 332319. Its contract address is `bchtest:p044v2t3jcw8f6l4ehcuuj86j890u89l0qy708zjjsvlp8xz0ks8u8rvagjcz`.

| Step | Txid | Link |
|---|---|---|
| Open | `09bc10e263fa92d97b3326817547e7c07d9afbada2c77bdefff2399b6ccf6635` | [view](https://chipnet.imaginary.cash/tx/09bc10e263fa92d97b3326817547e7c07d9afbada2c77bdefff2399b6ccf6635) |
| Early refund at height 332318 | **rejected by the chipnet node**: "Transaction is not yet final (nLockTime not satisfied)" | |
| **Refund** after the timeout (height 332319) | `235c78a1d061112ccf904940233ccbfdff3b24c5d3521fc5f790367c8cd4c2a1` | [view](https://chipnet.imaginary.cash/tx/235c78a1d061112ccf904940233ccbfdff3b24c5d3521fc5f790367c8cd4c2a1) |

## 3. Tab C: full HTTP paywall flow

The server is `packages/server/src/main.ts` and the client is `packages/server/scripts/agent-demo.ts`.

The flow:
1. `GET /api/oracle` returns `402` with `scheme=bch-credit price=1000 payTo=<provider pubkey>`.
2. The agent opens a tab on chain and calls `POST /tabs`; the server checks the utxo on chipnet and returns 201.
3. Three paid calls (vouchers for 1000, 2000 and 3000 sats) each return `200`.
4. Replaying voucher #3 returns `402 replayed_voucher`.
5. `POST /tabs/:id/settle` makes the server settle on chain.

| Step | Txid | Link |
|---|---|---|
| Open | `7724616e1dc99c88d706340ce27f9d386146021cb8be57c0a2c0f85521e7d814` | [view](https://chipnet.imaginary.cash/tx/7724616e1dc99c88d706340ce27f9d386146021cb8be57c0a2c0f85521e7d814) |
| Server settle (3000 sats) | `2a58b9b19e41c14f51213ae476406f39d33b584ec64e35bb900634e160212757` | [view](https://chipnet.imaginary.cash/tx/2a58b9b19e41c14f51213ae476406f39d33b584ec64e35bb900634e160212757) |

## Confirmation status

All of these transactions were accepted to the chipnet mempool. That means they passed full node script validation, including the covenant. Run `node packages/covenant/scripts/tx-status.ts <txid>...` to check confirmations.

At the last check (2026-11-14 14:23 UTC, tip 332320), every tx above was still **0-conf in the mempool**, including the faucet's own funding tx (1 sat/byte). Chipnet blocks 332319 and 332320 were mined without them, which looks like sparse or empty testnet mining. Re-check later with:

```sh
node packages/covenant/scripts/tx-status.ts 6f14f00fc1a4bc9c480038df08fe6c953d5d86cd018f4c2a09cfd73cbf10c8ed 235c78a1d061112ccf904940233ccbfdff3b24c5d3521fc5f790367c8cd4c2a1 2a58b9b19e41c14f51213ae476406f39d33b584ec64e35bb900634e160212757
```
