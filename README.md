# AgentTab

**Open a refundable tab for your AI agent on Bitcoin Cash.**

An agent locks a small budget in a covenant. Each paid API call carries one off-chain voucher for the **cumulative** amount owed: no on-chain transaction per call, and no custodial balance.

- The provider settles once and receives exactly what was signed.
- The covenant forces the remainder back to the agent's owner.
- If the provider vanishes, the owner reclaims everything after the timeout.

The HTTP flow is x402-shaped:
1. The API answers `402 Payment Required` with a `bch-credit` scheme.
2. The agent opens a tab.
3. Each request then carries `X-PAYMENT: base64({scheme:"bch-credit", payload:{tab, amount, sig}})`.

> **Disclosure:** a small pre-hackathon prototype, written before the BCH BLAZE 2026 build window opened on 2026-11-14 14:00 UTC, exists in a separate folder/repo (link: _TBD_). This repository was started from scratch after kickoff. No files or commits were copied from the prototype.

> **Prior art:** PSF `x402-bch` / `x402-bch-express` (per-request payments, plus custodial "batch debit"). AgentTab proposes a non-custodial, covenant-backed `bch-credit` scheme alongside it.

## Layout

```
packages/covenant   AgentTab.cash (CashScript 0.14) + TS SDK (open, sign/verify voucher, settle, refund) + tests
packages/server     paywall API: 402 terms, per-request voucher verification, highest-voucher ledger, settle on demand
docs/               security.md (threat model and known weaknesses), chipnet-proof.md (on-chain txids)
```

Planned next: `packages/mcp` (an MCP server so the agent pays for itself) and `apps/web` (WizardConnect human funding and a live txid feed).

## Run

Requires Node 23.6+ (runs TypeScript natively; no build step).

```sh
npm install
npm test                                     # 15 covenant tests + 10 server tests (MockNetworkProvider)
npm run typecheck
npm run build:contract                       # recompile AgentTab.cash -> AgentTab.json

# chipnet (testnet only)
node packages/covenant/scripts/keygen.ts      # throwaway chipnet keys -> .env (gitignored)
# fund the OWNER address from a chipnet faucet (e.g. https://chipnet.bch.ninja)
node packages/covenant/scripts/chipnet-demo.ts   # open -> 3 vouchers -> settle; second tab: early refund rejected -> refund after timeout
node packages/server/src/main.ts &               # paywall on :8402
node packages/server/scripts/agent-demo.ts       # 402 -> open tab -> register -> 3 paid calls -> replay rejected -> settle
```

## Voucher format

```
msg      = "AGENTTAB" (8 bytes) ‖ fundingTxHash (32, internal byte order) ‖ vout (uint32 LE) ‖ cumulativeAmount (uint64 LE)
voucher  = schnorr_sign(ownerKey, sha256(msg))      # verified on-chain by OP_CHECKDATASIG
```
