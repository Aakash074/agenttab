# AgentTab

**A refundable tab for your AI agent on Bitcoin Cash: one transaction for N API calls.**

You lock a budget in a covenant with **one transaction**. Your agent then pays for each API call with an off-chain voucher, signed for the **cumulative** amount owed. Vouchers are instant, free and need no on-chain transaction.

- The provider settles **once** and can take only what was signed.
- The covenant forces the remainder back to you.
- If the provider disappears, you reclaim everything after the timeout.
- The agent's key can sign vouchers but can never withdraw.

Other BCH "agent budget" designs pay one on-chain transaction per call. AgentTab is a payment channel: two transactions in total, however many calls.

## Verify it in 5 minutes (chipnet)

| # | Do this | You should see |
|---|---|---|
| 1 | Open the app and press **▶ Run the demo agent** | The receipt animates: `402 Payment Required` → voucher #N → `200 OK`. The feed gets a *PAID CALL* row and the counter shows "N API calls · K on-chain txs". |
| 2 | **Connect → Chipnet test wallet → Get 25,000 free test sats** | The balance appears in about 5 s. No signup and no faucet captcha. |
| 3 | **Open tab with 20,000 sats** for the prefilled *demo agent*, then **▶ Run agent on this tab** a few times | An *open* tx link (explorer). The receipt is pinned to *your tab* and the voucher count goes up. *Spent* rises on your tab card. No new transactions appear. |
| 4 | **Close tab now** | "Returned to you: N sats". Open the settle tx in the explorer: it has exactly two outputs, the provider's share and your exact remainder. |
| 5 | Scroll to **Try to cheat the tab → Run 6 attacks** | A fresh chipnet tab is attacked. Replay, overclaim, forged amount, wrong remainder, early refund and agent-withdraw are all **REJECTED**, with the chipnet node's verbatim reason (e.g. `mandatory-script-verify-flag-failed (Script failed an OP_EQUALVERIFY operation)`, `bad-txns-nonfinal`). Then the honest settle is accepted. |

For agents, an MCP server (`packages/mcp`) gives Claude or any MCP client `fetch_paid`, `tab_status`, `close_tab` and `agent_info`. On-chain evidence (txids) is in [`docs/chipnet-proof.md`](docs/chipnet-proof.md). The threat model is in [`docs/security.md`](docs/security.md).

## `bch-credit`: an x402-bch-shaped scheme

AgentTab uses the same HTTP flow as **x402-bch** (v2.2):
1. The server answers `402 Payment Required` with an `accepts[]` list.
2. The client retries with an `X-PAYMENT` header.
3. The server replies `200` with `X-PAYMENT-RESPONSE`.

AgentTab adds one new scheme, **`bch-credit`**. It isn't a per-request on-chain payment. The payload is `{tab, amount, sig}`, a voucher against a covenant-locked tab. The `extra` field of the 402 offer describes how to open a tab (`POST /tabs`) and the voucher format.

Prior art and credit:
- **PSF `x402-bch` / `x402-bch-express`**: the BCH x402 implementation; its "batch debit" mode is custodial.
- **OPTN Labs** (`x402-bch`, `ai-covenant` allowance vaults).

`bch-credit` is meant to sit alongside their `exact`-style scheme in the same `accepts[]`, so one server can offer both.

## Honest build timeline

All times are UTC. The BLAZE build window opened 2026-11-14 14:00.

- **Before kickoff:** an idea gate and a small throwaway prototype (a covenant sketch plus a Vite scaffold), kept in a **separate folder/repo** (link: _TBD_). No files or commits from it are in this repo.
- **Nov 14, 14:04–14:20:** fresh repo; covenant, SDK and 15 tests; paywall server. First chipnet open → 3 vouchers → settle, an early refund rejected by the node, and a refund after timeout ([proof §1–3](docs/chipnet-proof.md)).
- **Nov 14, 14:29–14:44:** covenant v2 (owner/agent split); live feed and auto-settle; web app; MCP server, which paid on chipnet both from a tab funded in the web app and from a tab it opened itself.
- **Nov 14, 14:53–15:15:** UX reviews 1 and 2: hosted demo agent, chipnet drip faucet, mainnet code path (mock-tested, not broadcast), close-tab-now, "Try to cheat the tab" panel, property tests.
- **Next:** hosting, the first mainnet transaction with a real Paytaca wallet over WizardConnect, deck and video.

> **Disclosure:** a small pre-hackathon prototype exists in a separate folder/repo (link: _TBD_). This repository was started from scratch after kickoff.

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
npm test                                       # 53 tests: covenant 22 (incl. property tests), server 26, mcp 5
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
| `TRUST_PROXY=1` | Use X-Forwarded-For for rate limits when behind a reverse proxy. |

### Mainnet

The mainnet path is implemented and tested on a mock chain. **No mainnet transaction has been broadcast by this repo.**

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

Banner values come from `VITE_DECK_URL`, `VITE_REPO_URL`, `VITE_DONATION_ZADDR` and `VITE_PROTOTYPE_URL`. Mainnet in the network selector is disabled unless `VITE_ENABLE_MAINNET=1` and `VITE_SERVER_URL_MAINNET` is set.

## Voucher format

```
msg      = "AGENTTAB" (8 bytes) ‖ fundingTxHash (32, internal byte order) ‖ vout (uint32 LE) ‖ cumulativeAmount (uint64 LE)
voucher  = schnorr_sign(agentKey, sha256(msg))      # verified on-chain by OP_CHECKDATASIG
```
