# DoraHacks BUIDL text (draft — paste after the author edits)

Two variants are marked below: **[TESTNET-ONLY]** if no mainnet payment exists by submission, **[MAINNET]** if H11 is done. Delete the variant you don't use. Everything marked [Author to write] must be written by the author, in their own words.

---

## Pitch line
AgentTab: a refundable tab for your AI agent on Bitcoin Cash. One transaction to open, any number of paid API calls, one transaction to settle. Whatever isn't spent comes back to you.

## Links
- Live demo: https://agenttab-wihk.onrender.com (free hosting: the first load can take up to a minute)
- Repo: https://github.com/Aakash074/agenttab
- Widget Factory deck: [link]
- CashTokens address: bitcoincash:zqcgm29z05erjdk440n6pj2vwmc8x5gxzcnwfnnrul
- Demo video (<2 min): [link]
- Pre-hackathon disclosure: a small throwaway prototype lives in a separate repo, https://github.com/Aakash074/agenttab-prototype. The main repo started from scratch after kickoff (Nov 14 14:00 UTC).

## Problem
AI agents are starting to pay for APIs per request (x402). On BCH today there are two ways to do it:
- **Pay on-chain per call:** one transaction and one fee per request, and the agent holds a hot wallet that can spend everything.
- **Prepay the provider:** fast, but custodial. You trust the provider's ledger for what each call cost and for your refund.

## What AgentTab does
1. **Open (1 tx):** the owner locks a budget in a CashScript covenant naming three keys: owner, agent, provider. The agent key can only sign vouchers; it can never withdraw.
2. **Pay per call (0 tx):** the API answers `402 Payment Required` with a new x402 scheme, `bch-credit`. The agent replies with a voucher signed for the cumulative amount, bound to the tab's funding outpoint. Checked instantly, off-chain.
3. **Close (1 tx):** the provider settles once and can take at most what was signed; the covenant forces the exact remainder back to the owner. The provider can also cancel (everything back), and after the timeout the owner refunds everything without the provider.

The live site counts it: every paid call so far versus the on-chain transactions it actually took.

## Try to cheat the tab
One button opens a fresh tab and fires 7 real attacks at it: voucher replay, overclaim, forged amount, remainder sent elsewhere, early refund, agent withdrawal, provider cancelling into its own wallet. All 7 are rejected, with the node's own error shown. Then the honest settle is accepted.

## For agents
An MCP server gives Claude or any MCP client four tools: `fetch_paid`, `tab_status`, `close_tab`, `agent_info`, with spend caps.

## On-chain proof
**[TESTNET-ONLY]** Everything runs on chipnet (BCH testnet); txids for open, settle, cancel, refund-after-timeout and all 7 rejected attacks are in `docs/chipnet-proof.md`. Mainnet is deploy-ready: `mainnet-dryrun.ts` builds the unsigned WizardConnect open transaction against live mainnet UTXOs, and the server enforces a budget cap and mainnet guards. [Author to write: one honest line on why mainnet isn't live yet]

**[MAINNET]** Mainnet: open [txid], 3 paid calls, settle [txid] (two outputs: provider's share and the owner's exact remainder). 1¢ direct pay: [txid]. Chipnet history in `docs/chipnet-proof.md`.

## How it compares
| Approach | On-chain txs for N calls | Who can take unspent money |
|---|---|---|
| Pay per call (x402-bch exact, Satchel vault) | N | nobody, but N fees |
| Custodial prepaid tab / facilitator batch | 1 or few | the server or facilitator |
| **AgentTab `bch-credit`** | **2** | **nobody: the covenant refunds the owner** |

Credit: PSF `x402-bch` / `x402-bch-express` and OPTN Labs `x402-bch` (same HTTP flow; `bch-credit` sits next to their schemes in `accepts[]`). Payment-channel prior art: Streamium, CashCast.

## Architecture and stack
- `packages/covenant`: CashScript contract (126 bytes, P2SH32), voucher signing (Schnorr datasig), tx builders.
- `packages/server`: x402 paywall (Node, TypeScript), tab ledger, settle/cancel ticker, chain replay after restarts.
- `packages/mcp`: MCP server for agents.
- `apps/web`: React + Vite + Tailwind, WizardConnect (Paytaca) for the human wallet.
- Tests: unit, property and HTTP tests, including a 500-step adversarial voucher stream.

## Screenshots (4+)
1. Hero with a settled receipt. 2. Tab card mid-spend next to the live feed. 3. Attack panel, 7/7 rejected. 4. Explorer view of a settle with two outputs. 5. Claude calling `fetch_paid`.

## Roadmap
- Propose `bch-credit` to the x402-bch maintainers.
- [TESTNET-ONLY] Mainnet launch with Paytaca over WizardConnect.
- [Author to confirm] Top-ups, multi-provider tabs, PUSD-denominated tabs.

## Why I built this
[Author to write]
