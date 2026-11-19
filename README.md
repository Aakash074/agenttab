# AgentTab

**A refundable tab for your AI agent on Bitcoin Cash: one transaction for N API calls.**

You lock a budget in a covenant with **one transaction**. Your agent then pays for each API call with an off-chain voucher, signed for the **cumulative** amount owed. Vouchers are instant, free and need no on-chain transaction.

- The provider settles **once** and can take only what was signed.
- The covenant forces the remainder back to you.
- If the provider disappears, you reclaim everything after the timeout.
- The agent's key can sign vouchers but can never withdraw.

Paying for each call on-chain costs one transaction per call. AgentTab is a payment channel instead: two transactions in total, however many calls. On chipnet the two cost 776 sats in fees together (open 229 bytes + settle 547 bytes at 1 sat/byte).

**Live on BCH mainnet:** a real Paytaca wallet paid 1¢ for an oracle answer on 2026-11-19: [`33d32acd51…`](https://explorer.bch.ninja/tx/33d32acd51481b100fbaf43d6e5ffdbdec69d297cfe8e6b00ec02f0f16f7efe3) ([docs/mainnet-proof.md](docs/mainnet-proof.md)). Hosted mainnet API: https://agenttab-api-mainnet.onrender.com.

## Verify it in 5 minutes (chipnet)

The app opens on mainnet (the 1¢ payment works there with Paytaca). The free 5¢ tab demo, test wallet and attack panel run on chipnet: pick *Chipnet* in the header, or open https://agenttab-wihk.onrender.com/?net=chipnet directly.

**Try it in 30 seconds: pay 1¢.** Type a question in the first card, press **Ask the oracle — 1¢**, connect Paytaca (WizardConnect) and approve one payment of about 1 US cent. The answer and the transaction's explorer link appear under the card, and the feed shows it as *1¢ direct pay*. It is a single plain payment (no tab) bound to the invoice by an `OP_RETURN`, accepted at 0-conf.

| # | Do this | You should see |
|---|---|---|
| 1 | Open the app and press **"Give an AI agent a 5¢ tab. Watch it pay 3 API calls. Get your change back."** and pick *Chipnet test wallet* | The stepper fetches free test coins (no signup), then opens the tab: **one transaction** (explorer link). |
| 2 | Watch the receipt on the right | `402 Payment Required` → `X-PAYMENT` voucher #1, #2, #3 → `200 OK`. **No transactions** for the calls; the bar drains. |
| 3 | Wait for step 5 | The tab is closed in **one transaction**: "Change back: 17,000 sats". In the explorer the settle has exactly two outputs, the provider's 3,000 (minus its fee) and your exact remainder. |
| 4 | Open **Advanced: fund your own agent** | Paste any agent pubkey (from the MCP tool `agent_info`), pick a budget and timeout, and see the covenant source and the provider key. |
| 5 | Scroll to **Try to cheat the tab → Run 7 attacks** | A fresh chipnet tab is attacked. Replay, overclaim, forged amount, wrong remainder, early refund, agent-withdraw and cancel-to-self are all **REJECTED**, with the chipnet node's verbatim reason (e.g. `mandatory-script-verify-flag-failed (Script failed an OP_EQUALVERIFY operation)`, `bad-txns-nonfinal`). Then the honest settle is accepted. |

For agents, an MCP server (`packages/mcp`) gives Claude or any MCP client `fetch_paid`, `tab_status`, `close_tab` and `agent_info`. On-chain evidence (txids) is in [`docs/chipnet-proof.md`](docs/chipnet-proof.md). The threat model is in [`docs/security.md`](docs/security.md).

## `bch-credit`: an x402-bch-shaped scheme

AgentTab uses the same HTTP flow as **x402-bch** (v2.2):
1. The server answers `402 Payment Required` with an `accepts[]` list.
2. The client retries with an `X-PAYMENT` header.
3. The server replies `200` with `X-PAYMENT-RESPONSE`.

AgentTab adds one new scheme, **`bch-credit`**. It isn't a per-request on-chain payment. The payload is `{tab, amount, sig}`, a voucher against a covenant-locked tab. The `extra` field of the 402 offer describes how to open a tab (`POST /tabs`) and the voucher format.

Prior art and credit:
- **PSF `x402-bch` / `x402-bch-express`**: the BCH x402 implementation; its "batch debit" mode is custodial.
- **OPTN Labs** (`x402-bch`).

`bch-credit` is meant to sit alongside their `exact`-style scheme in the same `accepts[]`, so one server can offer both.

### How it compares

| Approach | On-chain txs for 100 paid calls | Who can take the unspent budget | Per-call latency |
|---|---|---|---|
| Per-call payment (x402 `exact`, agent spend-limit wallets) | 100 | No one, but every call waits for a broadcast | one tx broadcast |
| Capped covenant vault, one payment tx per call (e.g. Satchel, also in this hackathon) | 100 | No one: per-period cap + payee allowlist, owner can withdraw any time | one tx broadcast + 0-conf check |
| Facilitator batch settlement (e.g. Coinbase x402 batch, PSF batch debit) | a few, settled later | The facilitator holds the funds in the meantime | none (an off-chain IOU) |
| Custodial prepaid tab (e.g. x402-bch v2.2 "tab" with batched debits) | 1 (the prepay) | The server: you prepay it and trust its ledger for what each call cost | none (server-side debit) |
| **AgentTab `bch-credit`** | **2** (open + settle) | **No one.** The covenant only pays the provider what the agent signed for; the rest returns to the owner, or the owner refunds after the timeout | none (a signed voucher, checked locally) |

The settle is one transaction with exactly two outputs, so the provider claims all 100 calls in that single transaction.

A capped vault is the better fit when an agent pays **many different providers** with no expiry. A tab is the better fit when an agent makes **many calls to one API**: the calls cost no on-chain fee and wait for no broadcast, and the provider is still guaranteed every voucher the agent signed.

**Prior art, named honestly.** The mechanism is a one-way payment channel, the same family as Spilman channels, Streamium (BCH, 2017) and, in this hackathon, CashCast (pay-per-second music). What AgentTab adds is what an *AI agent* needs and a human listener does not:
- the agent holds a key that can **only sign vouchers**: it cannot move the deposit, only the owner can;
- a machine-readable **402 `bch-credit` scheme**, so any x402 client can discover and pay;
- an **MCP server**, so Claude and other agents use it as a tool with no wallet code;
- a **provider `cancel()`** and a live panel that replays **7 attacks** against the covenant on chipnet.

Also in this hackathon, **LaunchDesk** uses a per-order CashScript escrow so a *human pays an AI* for one finished job, released on delivery. AgentTab is the other direction: an *AI agent pays any API* per call, many calls on one budget, 2 transactions in total.

## Business model
API providers run a hosted AgentTab paywall and pay **1% of what their tabs settle**. Agents and their owners pay nothing extra, and settlement stays non-custodial: funds go from the covenant straight to the provider. The middleware, MCP server and SDK stay open source. No paying provider yet.

## Build timeline

- **Before 2026-11-14 (pre-hackathon):** idea research and a small throwaway prototype in a separate repo, [Aakash074/agenttab-prototype](https://github.com/Aakash074/agenttab-prototype). It has a 30-line covenant sketch, 5 mock tests and an empty Vite scaffold.
- **2026-11-14 (kickoff day, after 14:00 UTC):** this repo started from scratch.
  - Covenant, SDK, paywall server, MCP server and web app.
  - First chipnet settle, refund and attack runs ([proof](docs/chipnet-proof.md)).
  - Four UX review passes, one judge review and one copy audit, each followed by fixes.
  - Covenant versions: v1 (one key for owner and agent), v2 (owner/agent split), v3 (adds `cancel`, current). The chipnet proof labels each run with its version.
- **2026-11-15 → 11-21:** hosting, the first mainnet transaction with a real Paytaca wallet over WizardConnect, deck and video.

## What changed vs the pre-hackathon prototype

| Area | Prototype (before kickoff) | This repo (after kickoff) |
|---|---|---|
| Voucher binding | `sha256(contract bytecode) ‖ amount`. Replayable on any second utxo at the same address, or on another tab with the same parameters. | `"AGENTTAB" ‖ funding outpoint ‖ amount`. Bound to one utxo, with a domain tag. |
| Keys | One key: the agent was the owner, so it could also refund and withdraw. | **Owner** (human wallet: remainder and refund) is separate from **agent** (signs vouchers only, can never withdraw). |
| Transaction shape | No input or output count checks, so tabs could be bundled and outputs added. | Exactly 1 input and 2 outputs (settle) or 1 output (cancel); tokens forbidden. |
| Fees | Paid from the owner's remainder (owner ≥ budget − amount − 1000). | The provider pays the fee from its own share. The owner gets **exactly** budget − amount. |
| Early close | None: the owner waits for the timeout. | `cancel(providerSig)`: the provider can waive the tab and return everything right away (fee capped). |
| Off-chain | None. | Paywall server: 402 `bch-credit` terms, per-request voucher checks, replay protection, auto-settle/cancel before timeout, live feed. |
| Agents | None. | MCP server: `fetch_paid`, `tab_status`, `close_tab`, `agent_info`, with spend caps. |
| UI | Empty Vite scaffold. | One-button journey, live receipt, WizardConnect and chipnet test-wallet signers, "Try to cheat the tab" panel. |
| Tests | 5 mock tests. | Unit, property and HTTP tests, plus live chipnet attack runs. |

## How I built this

Built with Claude Code as a pair programmer, which is why the history is dense and commits are co-authored. The prototype repo (linked above) is where the covenant idea was worked out before kickoff. My decisions: [Author to write].

## Design decisions


[Author to write]

> **Disclosure:** a small pre-hackathon prototype exists in a separate folder/repo ([Aakash074/agenttab-prototype](https://github.com/Aakash074/agenttab-prototype)). This repository was started from scratch after kickoff.

## Layout

```
packages/covenant   AgentTab.cash (CashScript 0.14) + TS SDK (open, sign/verify voucher, settle, refund; wallet-signing helpers)
packages/server     paywall API: 402 terms, per-request voucher checks, live feed (JSON + SSE), auto-settle, BCH oracle
packages/mcp        MCP server (stdio): fetch_paid / tab_status / close_tab / agent_info
apps/web            Vite + React + Tailwind: live feed, fund a tab (WizardConnect or chipnet test wallet), tab status, refund
docs/               security.md (threat model), chipnet-proof.md (txids)
```

## Run locally (chipnet)

Requires Node 23.6+ (runs TypeScript natively).

```sh
npm install
npm test                                       # 58 tests: covenant 24 (incl. property tests), server 29, mcp 5
npm run typecheck

node packages/covenant/scripts/keygen.ts       # throwaway chipnet keys -> .env (OWNER / AGENT / PROVIDER)
node packages/covenant/scripts/pubkeys.ts      # print pubkeys/addresses; fund OWNER at https://chipnet.bch.ninja

# fund FAUCET (drip for visitors' test wallets) and DEMO_AGENT (hosted demo agent) from OWNER:
node packages/covenant/scripts/send.ts <FAUCET address> 300000
node packages/covenant/scripts/send.ts <DEMO_AGENT address> 200000
npm run dev:server                             # paywall on http://localhost:8402  (NETWORK=chipnet by default)
cp apps/web/.env.example apps/web/.env.local   # banner links, z-address, demo agent pubkey
npm run dev:web                                # web on http://localhost:5173 (proxies the API)
node packages/mcp/scripts/mcp-demo.ts http://localhost:8402 3   # an MCP client paying 3 calls, then closing the tab
```

### Server endpoints

| Endpoint | Description |
|---|---|
| `GET /api/oracle?q=` | Paid, 1000 sats per call. Returns live BCH/USD (CoinGecko, Kraken fallback, no API keys) plus the chain tip. |
| `GET /.well-known/agenttab` | Provider pubkey, network, prices. |
| `POST /tabs` `{txid, vout, ownerPub, agentPub, timeout}` | Register a tab. The server checks it on chain. |
| `GET /tabs?agent=&owner=` | List tabs. |
| `GET /tabs/:id` | One tab. |
| `POST /tabs/:id/settle` | Settle now. Protected by `ADMIN_TOKEN` if set. |
| `GET /feed?since=` | Feed events as JSON. |
| `GET /feed/stream` | Feed events as SSE. |
| `POST /demo/call` `{tab?}` | The hosted demo agent makes one real paid call through the 402 flow. It uses the visitor's tab for the demo agent if given, else its own tab. Rate-limited. A cron also calls every `DEMO_CRON_SECONDS`. |
| `GET /demo` | Demo agent status. |
| `POST /faucet/drip` `{address}` | **Chipnet only.** Sends `DRIP_SATS` to a `bchtest:` P2PKH test wallet. Limited to once per address per day, 2 per IP per hour, 30 per hour in total. |
| `POST /direct` `{q}` | 1¢ direct pay: creates an invoice `{invoiceId, payTo, amountSats, opReturn, expiresAt}` (15 min). Rate-limited. |
| `POST /direct/:id/pay` `{rawTx}` or `{txid}` | Checks the tx pays at least `amountSats` to `payTo` and carries `OP_RETURN "AGENTTAB" <invoiceId>`, broadcasts `rawTx`, accepts 0-conf and returns the oracle answer. Each invoice and each txid pays once. Also advertised as an `exact` option in the oracle's 402 `accepts[]`. |
| `GET /contract` | `AgentTab.cash` source. |

Server config is read from `.env` or the environment:

| Variable | Default / meaning |
|---|---|
| `NETWORK` | `chipnet` (default). `mainnet` is refused unless `ALLOW_MAINNET=1` and a mainnet WIF is used. |
| `PROVIDER_WIF` | Provider key. |
| `PORT` | `8402` |
| `PRICE_SATS` | `1000` |
| `SAFETY_BLOCKS` | `6`. Tabs within 6 blocks of their timeout refuse vouchers and are auto-settled. |
| `TICK_SECONDS` | `30` |
| `ADMIN_TOKEN` | Optional; protects the settle endpoint. |
| `DEMO_AGENT_WIF` | Key for the hosted demo agent. `DEMO_CRON_SECONDS` defaults to 60 (0 turns it off); `DEMO_BUDGET_SATS` defaults to 20000. Off on mainnet unless `DEMO_ON_MAINNET=1`. |
| `FAUCET_WIF` | Key for the chipnet drip. `DRIP_SATS` defaults to 25000. Never enabled on mainnet. |
| `MAX_TAB_BUDGET_SATS` | Largest tab the server accepts. Default 100000 on mainnet, unlimited on chipnet. |
| `DIRECT_PRICE_SATS` | Price of a 1¢ direct-pay answer. Default: about 1 US cent at the live BCH price (2000 if unknown), never below dust. |
| `TRUST_PROXY=1` | Use X-Forwarded-For for rate limits when behind a reverse proxy. |

### Mainnet

The mainnet API is live at https://agenttab-api-mainnet.onrender.com. The first mainnet transaction is a real Paytaca 1¢ direct payment on 2026-11-19 (see [docs/mainnet-proof.md](docs/mainnet-proof.md)). The covenant tab flow is enabled on mainnet (max tab 100k sats); its open/settle/refund and the 7 rejected attacks are proven on chipnet.

To run it:
```sh
NETWORK=mainnet ALLOW_MAINNET=1 PROVIDER_WIF=<mainnet WIF> PORT=8403 node packages/server/src/main.ts
```
Then build the web app with `VITE_SERVER_URL_MAINNET=https://…`.

On mainnet:
- The price defaults to 100 sats per call.
- Tabs above 100k sats are refused.
- Budgets in the UI are 3k, 5k and 10k sats.
- The demo agent and the faucet are off.

`node packages/covenant/scripts/mainnet-dryrun.ts [bitcoincash:q…]` builds the unsigned WizardConnect open-tab transaction against live mainnet UTXOs and prints it. It never signs and never broadcasts.

### MCP (give your agent a tab)

```json
{ "mcpServers": { "agenttab": {
  "command": "node", "args": ["/path/to/agenttab/packages/mcp/src/index.ts"],
  "env": { "AGENT_WIF": "<testnet WIF>", "NETWORK": "chipnet", "MAX_BUDGET_SATS": "20000", "MAX_PRICE_SATS": "5000", "MAX_TOTAL_SATS": "100000" }
} } }
```

On a 402, `fetch_paid` pays from a tab in this order:
1. a tab a human funded for this agent's pubkey (found via `/tabs?agent=` and verified on chain);
2. otherwise, a new tab it opens from the agent's own address, capped at `MAX_BUDGET_SATS`.

### Web

The page shows three things:
- a hero with the latest paid call and its on-chain open and settle txids;
- the live feed;
- the "Fund your agent's tab" form, which takes the agent pubkey, budget and refund timeout.

Two signers are available:
- **WizardConnect** (Paytaca etc.): the dapp builds the tx with placeholder signatures and the wallet signs it.
- **Chipnet test wallet**: a throwaway key in localStorage, chipnet only.

The "Your tabs" panel shows budget, spent, remaining and the refund countdown, and has a Refund button that unlocks after the timeout.

Banner values come from `VITE_DECK_URL`, `VITE_REPO_URL`, `VITE_DONATION_ZADDR` and `VITE_PROTOTYPE_URL`. Mainnet in the network selector is enabled when `VITE_SERVER_URL_MAINNET` is set at build time (hosted: https://agenttab-api-mainnet.onrender.com).

## Voucher format

```
msg      = "AGENTTAB" (8 bytes) ‖ fundingTxHash (32, internal byte order) ‖ vout (uint32 LE) ‖ cumulativeAmount (uint64 LE)
voucher  = schnorr_sign(agentKey, sha256(msg))      # verified on-chain by OP_CHECKDATASIG
```
