# Chipnet proof: AgentTab covenant end to end

> Sections 1–3 used **covenant v1**, where the owner key also signed vouchers. Section 4 uses **covenant v2** (the current one): `owner` (human wallet; gets the remainder and can refund) is separate from `agent` (signs vouchers only).

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

## 4. Covenant v2: human funds in the web app, agent pays via MCP, provider settles

These runs used the server's v2 features: feed, auto-settle and live oracle. The server ran `node packages/server/src/main.ts` with provider pubkey `037452d7…087d59`.

| Step | Txid | Link |
|---|---|---|
| (v2, HTTP agent demo) Open (owner key funds, agent key signs) | `7954027d3733961313c5e03908fb6aba1e25874e7bd9e8b3f20354a0e124b749` | [view](https://chipnet.imaginary.cash/tx/7954027d3733961313c5e03908fb6aba1e25874e7bd9e8b3f20354a0e124b749) |
| (v2, HTTP agent demo) 3 paid oracle calls, then replay rejected (402), then server settle of 3000 sats | `6a01e617601c2cce241807dafbf8fe3a1d872e0485d7e9668658d0febb9613d5` | [view](https://chipnet.imaginary.cash/tx/6a01e617601c2cce241807dafbf8fe3a1d872e0485d7e9668658d0febb9613d5) |
| **Web app**: the "Chipnet test wallet" (browser key) funds a 20,000-sat tab for the demo agent via the "Fund your agent's tab" UI | `dd59f8d197b81a713ea9bf527bc224cbdae45aa695c88c6cb6f76a06e37632b8` | [view](https://chipnet.imaginary.cash/tx/dd59f8d197b81a713ea9bf527bc224cbdae45aa695c88c6cb6f76a06e37632b8) |
| **MCP** `fetch_paid` ×3: the agent finds the human-funded tab via `/tabs?agent=`, checks it on chain, and pays 1000/2000/3000 cumulative | off-chain vouchers | |
| **MCP** `close_tab`: provider settles 3000; 17,000 goes back to the human wallet | `4f571d5258b8f2f4f72e3933eb2e7f631fb7b6506ace5f995cb6377acd592a16` | [view](https://chipnet.imaginary.cash/tx/4f571d5258b8f2f4f72e3933eb2e7f631fb7b6506ace5f995cb6377acd592a16) |
| **MCP**, no funded tab: the agent opens its own 20,000-sat tab (budget cap) from its own address | `80c2f41222a31a7f6d248a13f8841ff7cb6225b45666ad97f88c61a39226ca18` | [view](https://chipnet.imaginary.cash/tx/80c2f41222a31a7f6d248a13f8841ff7cb6225b45666ad97f88c61a39226ca18) |
| **MCP** `fetch_paid` ×2, then `close_tab`: settle 2000 | `96969d6b9d20571a4bab306c5717d1c4f87c32099927940455cf4cbe7f1f6895` | [view](https://chipnet.imaginary.cash/tx/96969d6b9d20571a4bab306c5717d1c4f87c32099927940455cf4cbe7f1f6895) |
| Helper top-ups (owner key to browser test wallet / agent) | `c0556cf8a53b41efdb66bedf391e9a007e500e749867a78a49b3ee199bad09ab`, `716db04c389a21b7e44f1d3a0140572463af0fc55f0c4e160829d1158c2d9ae7` | |

To reproduce: run `node packages/server/src/main.ts`, then `node packages/mcp/scripts/mcp-demo.ts http://localhost:8402 3`.

## 5. Judge flow in the browser (UX review round 1)

1. A fresh chipnet test wallet got 25,000 sats from the server drip (`POST /faucet/drip`).
2. That wallet funded a 20,000-sat tab for the hosted demo agent in tx `8ab32555bbe224bdd6e7d15ae6f98cb0b91a1a60b1a8b11e07a212f04c30cbbb`.
3. "Run the demo agent" paid 1,000 sats from that tab ("from your tab").

The demo agent's own tab was opened in tx `bc3202f132f27d85ab8c83d74bb0fe598d97b44e195932766e000765f236ee06`. The cron and the button pay from it every 60 s.

Server keys were funded from OWNER:
- faucet: `564407994e443a098e6b310f14810bdce87ebbb5a1428b490953db73d9e2644d`
- demo agent: `37f85f959414c9e114544fc053644bd0ce706cca62bcf504aa0fdef6ce0a285a`
- MCP agent top-up: `be0d237d6d56660cb08f8bc8ddf0a471252cbc75658674e953074e3e7d1490ce`

## 6. "Try to cheat the tab" (live attack run, 2026-11-14T15:16:19.590Z)

The server opened a fresh 6,000-sat tab in tx `ff4bbc96effdba2069932d556fc8e7fb4ea4a89cb2f9b8f119eefddf7f8b6324` at `bchtest:pvaq862xry9kggau8g669ka4lteyxxusre83weyrv8zpyk6pcks9uclwj7qpj`. It made 2 paid calls, then fired these attacks. Each covenant-level cheat was built without local checks and broadcast raw, so the message is the chipnet node's own.

| Attack | Rejected by | Verbatim reason | Attempted tx |
|---|---|---|---|
| Replay an old voucher | paywall server | `HTTP 402 replayed_voucher: voucher 2000 <= highest seen 2000` | — |
| Provider overclaims | chipnet node | `the transaction was rejected by network rules. mandatory-script-verify-flag-failed (Script failed an OP_VERIFY operation) (code 16)` | `c46a3b698869ce6e3c60b6b035680cf9ad5247fb32f83dff01b8f93305e8e1da` (never mined) |
| Provider rewrites the voucher amount | chipnet node | `the transaction was rejected by network rules. mandatory-script-verify-flag-failed (Signature must be zero for failed CHECK(MULTI)SIG operation) (code 16)` | `0341779e9965b36a5eb9c0cf2945d86b4a35fdb58b0a3d31e6ef32bcc29b106b` (never mined) |
| Send the remainder elsewhere | chipnet node | `the transaction was rejected by network rules. mandatory-script-verify-flag-failed (Script failed an OP_EQUALVERIFY operation) (code 16)` | `8fa0ed01bc09f9a0a19827105704e27b96fa0a581dbfa223c340f41127c550d6` (never mined) |
| Owner pulls the money early | chipnet node | `the transaction was rejected by network rules. bad-txns-nonfinal, non-final transaction (code 64)` | `6dd3e3feda3512ccd6caef668a0091e15b126d4d6cb8f121b9e282e3cf644fa8` (never mined) |
| Agent tries to withdraw | chipnet node | `the transaction was rejected by network rules. mandatory-script-verify-flag-failed (Signature must be zero for failed CHECK(MULTI)SIG operation) (code 16)` | `fe5ae98bfd7d3c51620c15ea57bfd56fddd13a3788dc90f8c6151a6354bd64d1` (never mined) |

The honest settle (2,000 sats to the provider, the exact remainder to the owner) was accepted in tx `86ab45b5f78f909f99a851a45ae6a72755fc149d5bbe3e126e7d61477817477e`.

UX r2 flow: closing the visitor's tab "now" settled 4,000 sats and returned 16,000 in tx `9111c176f58b29956480687bb7a9b58b1d842c26f4a0d6f4da06ba22147e2a0a`. The faucet key was topped up from the public chipnet PoW faucet in tx `e21fe6e397d5076584cf1ec316d3490e1035c1198f421af62fdd3cc3319cf18b`.

## 7. Covenant v3 (adds `cancel`): one-button journey and 7-attack run

> Covenant v3 adds `cancel(providerSig)`. All v2 tabs were settled before the switch (`fea66d9818457062702be9731cd0c01318f50b48b0a4011ffd87d66c65dd3012`, `c8f93d08f4e3e4a6cbb7459b80c6c5e7ed84610155b26e72f9a893d29c10a69f`).

- **Attack run:** the tab was opened in `8aaeed75843e99d1460f3457798d767c3b61908310078884274cd8f0da0b53db`. All 7 attacks were rejected, including the new "provider cancels into its own wallet" (`mandatory-script-verify-flag-failed (Script failed an OP_EQUALVERIFY operation)`). The honest settle was accepted in `e56a1c27bce6f49d5a9b59a985e23993342ecc1704832277092a66247460297d`.
- **One-button journey in the browser:**
  1. A fresh test wallet was dripped coins.
  2. It opened a 20,000-sat tab for the demo agent in `6e71c4a2…e7a441cd` (feed / explorer).
  3. The agent paid 3 calls with vouchers (1,000 / 2,000 / 3,000).
  4. The close settled 3,000 and returned 17,000 in `3987f76a69652ecbb4dc03aef90ce38d30bc146fc7e3f295bd52eded239b6509`.

## Confirmation status and why nothing confirmed at first (investigated 2026-11-14 ~16:15 UTC)

**Symptom:** between 14:05 and 16:15 UTC (blocks 332318–332329), none of our transactions confirmed. That includes the public faucet's own payout to us (`76822cfc…`). `blockchain.transaction.get` on `chipnet.bch.ninja` reported every one of them as "in mempool".

**What I checked** (`packages/covenant/scripts/chipnet-diagnose.ts`):

1. **Are miners mining empty blocks?** No. Every block from 332318 to 332329 contains several non-coinbase transactions (checked with `blockchain.transaction.id_from_pos`). Chipnet was confirming other people's transactions the whole time.
2. **Fee and policy.** Relay and mempool minimum is 1 sat/byte on both servers, and ours were at about 1 sat/byte, the same as the faucet's own 123-byte tx (123-sat fee). The txs are version 2, and the covenant outputs are standard P2SH32. Fee and standardness were not the problem.
3. **Do other nodes know the txs?** No. A second, independent server, `chipnet.imaginary.cash`, answered `No such mempool or blockchain transaction` for both the faucet payout and our settle. **The txs only existed in the mempool of the node behind `chipnet.bch.ninja`**, the server CashScript uses by default for chipnet and the one the BCH Ninja faucet itself broadcasts through. That node accepted them, which means it validated the scripts, but never relayed them to the rest of chipnet. So no miner ever saw them.
4. `chipnet.c3-soft.com` and `cbch.loping.net` were unreachable over WSS.

**Fix (on our side):**
- `packages/covenant/scripts/chipnet-rebroadcast.ts` pulled all **65** unconfirmed txs touching our addresses from `chipnet.bch.ninja`, parents included and in parent-before-child order. It pushed them to `chipnet.imaginary.cash`. All 65 were accepted (16:16 UTC, tip 332329).
- The SDK now has `electrumProvider(network)`. On chipnet it reads from `chipnet.imaginary.cash` and mirrors every broadcast to `chipnet.bch.ninja` (`MirroredElectrumProvider`). The server, MCP server, web app and scripts all use it, so no future transaction depends on a single node's peers.

**What the proof txids mean in the meantime:** every txid in this document was accepted by a full chipnet node's mempool. That means each one passed full consensus and script validation, including the covenant. Confirmation status after the rebroadcast is below and can be re-checked with:

```sh
node packages/covenant/scripts/tx-status.ts <txid>...
node packages/covenant/scripts/chipnet-diagnose.ts <txid>...   # compares several servers
```

**Result:** the next block, **332331** (mined 16:21 UTC, about 5 minutes after the rebroadcast), **confirmed every tx in this document**. I checked all 20 proof txids, from the faucet payout `76822cfc…` through the v3 attack-run settle `86ab45b5…`; each had 1 confirmation at tip 332331. They are now ordinary confirmed chipnet transactions; no re-run was needed.

## Hosted deployment run (2026-11-15, https://agenttab-wihk.onrender.com, driven in a real browser)
One-button journey (browser test wallet, faucet drip from the hosted server):
- Open tab #21E8, 20,000 sats: `21e81aba55dc8292890807c81effc952308b74ab756db85a6e0069f65e2fcd4f`
- 3 paid calls (vouchers 1,000 → 2,000 → 3,000 sats, 0 on-chain txs)
- Settle (provider 3,000 / owner 17,000): `0ce3dec01bc063ae96acacfd21b5a322685bac309c81f7ca791461c1a85545eb`

"Try to cheat the tab" from the hosted UI: 7/7 REJECTED (replay, overclaim, forge-amount, wrong-remainder, early-refund, agent-refund, cancel-to-self)
- Attack tab open: `32c3495fda96a4646e92754077deab1730460693067340f1b818dbb0c60fa72d`
- Honest settle accepted: `5a0cb526798085132840aac6244a774100e8f2ce79de338f4d787d712bc5a1ab`

## Note: chipnet faster blocks (2026-11-15)
Chipnet activated the faster-blocks upgrade (CHIP-2025-03) at height 332451 (measured): blocks now arrive about every minute, but height-based nLockTime still counts 10-minute units: lock height = 332451 + floor((h − 332451) / 10). AgentTab now compares tab timeouts with this "lock tip" everywhere (`lockTip` in packages/covenant/src/index.ts); mainnet is unchanged. Found when an owner refund at raw height 332649 (timeout 332642) was rejected as non-final; the refund for tab de3828…18d0 ran once the lock tip reached 332642: `de636f3c89b509c604db0414648a45721d1bde445edf6006e34634cd901af504` (2026-11-17, 49 conf). A second owner refund (unregistered tab, timeout 332699) was accepted the moment the lock tip reached 332699: `b64ef9d15b40904592fcd3b8daefb50faeb3a085af639b89e5fe88e83c57cabd` (2026-11-17 11:43 IST).
- Owner refund after the timeout with the lock-tip fix (2026-11-15): tab `87d7713cb06a72bab258732a117490708fd21de8b96777329cac174cbfeb8d94` (timeout 332481) refunded at lock tip 332481: `2ff91cfcb6568d007e23c0060ce4bce08793f31711c5102fa232700f34e0021d`

## 1¢ direct pay (2026-11-16)
The simplest human path: one plain payment from your own wallet for one oracle answer, no tab and no covenant. Run as the web app's WizardConnect wallet does it, against a local server on chipnet: `AGENTTAB_API=http://127.0.0.1:<port> node packages/covenant/scripts/direct-pay-e2e.ts`. The headless WizardConnect test wallet paired over the real relay, signed `buildDirectPay` (P2PKH input with placeholder unlocker, VM verify OK), and the server checked the payment and broadcast it.
- Invoice `e7696db607fe69ebbc175150`: 4,781 sats (about 1 US cent at $209/BCH) to the provider `bchtest:qzhyn0j9r7e5rsnkae4a5dej3nhtgn4f8vqj3v8xcc`, `OP_RETURN "AGENTTAB" "e7696db607fe69ebbc175150"`
- Payment tx (263 bytes, accepted at 0-conf): `8cd9f1dc8b2d845ae20965ba4c8af22bd22cc1a7f6a335b3c307ff64df12866e`
- Server answered `200` with the oracle answer and emitted a `direct` feed event. The same txid sent for a new invoice got `409 txid_used`.
- Hosted run (https://agenttab-api-chipnet.onrender.com, 2026-11-16 ~04:50 UTC, same script with `AGENTTAB_API` set to the hosted API): two payments, both `200` with the answer, both shown as "1¢ DIRECT PAY" in the hosted feed, and both txid replays refused with `409 txid_used`:
  - 4,793 sats: `d2d6e1f93b7a69c502e18a959db202942715a5ad1e40f2f6a4e8263b5286032d`
  - 4,791 sats: `72ad98aa07e0e235c68587c91b1c81618cd0af59c3963f6b05f13060f640b909`
- Provider cancel of a registered tab (2026-11-17): tab `462850dc46eeef4663cdc9b4c47b68d133d7fed178a88f56ccbb0d6742fcd758` (timeout 332642, no calls) was cancelled by the provider (`cancel()`, nLockTime 0, mined at height 332639) in `adeaa976864e7d7ee695a8535c411afe2e61e8cbd25f0a1ddafa3f3d85e8899d`: one output, 4,559 sats to the owner address `bchtest:qzxawz6q…qc5m`, before the owner refund ran; the owner refund then correctly found the coin already spent.

## Real Paytaca wallet over WizardConnect (2026-11-19)

The first payment signed by a real third-party wallet (Paytaca on Chipnet, connected over WizardConnect) on the hosted site, after fix `cb20e47` (sign requests now carry the unsigned transaction as hex).

| Step | Txid | Link |
|---|---|---|
| 1¢ direct pay (4,802 sats, one plain payment bound to the invoice by `OP_RETURN`) | `910eb34bcd42d7589db665accb3141d591274f2727c8c5e104b6b0fc7edcba16` | [view](https://chipnet.imaginary.cash/tx/910eb34bcd42d7589db665accb3141d591274f2727c8c5e104b6b0fc7edcba16) |
