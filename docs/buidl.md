## Pitch line
AgentTab: a refundable tab for your AI agent on Bitcoin Cash. One transaction to open, any number of paid API calls, one transaction to settle. Whatever isn't spent comes back to you.

## Links
- Live demo: https://agenttab-bch.onrender.com (opens on Mainnet; the free 5¢ tab demo is at https://agenttab-bch.onrender.com/?net=chipnet; free hosting, so the first load can take up to a minute)
- Repo: https://github.com/Aakash074/agenttab
- Widget Factory deck: https://docs.google.com/presentation/d/1HWXYkITgDgsd3Xc6NcHcST592q_E5ljSumN9d2bI-l4/edit?usp=sharing
- CashTokens address: bitcoincash:zqcgm29z05erjdk440n6pj2vwmc8x5gxzcnwfnnrul
- Demo video (1:24): https://youtu.be/bNDT09rOvoo
- Pre-hackathon disclosure: a small throwaway prototype lives in a separate repo, https://github.com/Aakash074/agenttab-prototype. No hosted demo of the prototype existed; its pre-kickoff state is commit 631e586 (https://github.com/Aakash074/agenttab-prototype/tree/631e586). The main repo started from scratch after kickoff (Nov 14 14:00 UTC), and its code was generated with AI assistance (Claude Code) live after kickoff, from the author's design.

## Try it
1. **Mainnet, 5¢ tab:** open https://agenttab-bch.onrender.com and press **Give an AI agent a 5¢ tab**. Approve one transaction in Paytaca (WizardConnect, Mainnet): about 5¢ is locked in the covenant, the hosted demo agent makes 10 paid calls with off-chain vouchers, and one settle transaction pays the provider and returns the rest to your wallet.
2. **Free, no wallet:** press **Try it free on Chipnet (no wallet) →** (or open https://agenttab-bch.onrender.com/?net=chipnet) and run the same tab with free test coins in about 40 seconds. Then open **Try to cheat it** and run the 7 attacks.
3. **Or pay 1¢:** on Mainnet, **Pay 1¢ for a live BCH price** is a single plain payment (no tab), bound to its invoice by an `OP_RETURN`.

## Problem
AI agents are starting to pay for APIs per request (x402). On BCH today there are two ways to do it:
- **Pay on-chain per call:** one transaction and one fee per request, and the agent holds a hot wallet that can spend everything.
- **Prepay the provider:** fast, but custodial. You trust the provider's ledger for what each call cost and for your refund.

## What AgentTab does
1. **Open (1 tx):** the owner locks a budget in a CashScript covenant naming three keys: owner, agent, provider. The agent key can only sign vouchers; it can never withdraw.
2. **Pay per call (0 tx):** the API answers `402 Payment Required` with a new x402 scheme, `bch-credit`. The agent replies with a voucher signed for the cumulative amount, bound to the tab's funding outpoint. Checked instantly, off-chain.
3. **Close (1 tx):** the provider settles once and can take at most what was signed; the covenant forces the exact remainder back to the owner. The provider can also cancel (everything back), and after the timeout the owner refunds everything without the provider.

The live site counts it: every paid call so far versus the on-chain transactions it actually took.

## Try to cheat it
On the site's **Try to cheat it** tab, **Run the 7 attacks** opens a fresh chipnet tab and fires 7 attacks at it: voucher replay, overclaim, forged amount, remainder sent elsewhere, early refund, agent withdrawal, provider cancelling into its own wallet. All 7 are blocked: the voucher replay by the paywall server, and the 6 real cheating transactions by the node, with its own error shown. Then the honest settle is accepted.

## For agents
An MCP server gives Claude or any MCP client four tools: `fetch_paid`, `tab_status`, `close_tab`, `agent_info`, with spend caps.

## On-chain proof

**Live on BCH mainnet, full covenant tab:** a 5¢ tab (24,597 sats) funded from the author's own Paytaca wallet through the site's normal mainnet flow was spent by our hosted demo agent on 10 API calls (600 sats each) with off-chain vouchers, and the provider settled once: 2 on-chain transactions for 10 calls, with exactly 18,597 sats forced back to the owner. Open 2e6bc19dd27c3225981a4c24e66b8874325f9b3955baa0639d7218145a89d7e8 · settle fe4560302f626ee884f83f766e92544511ec824899014bb076d1deb91a8b64df (explorer.selene.cash). Also a 1¢ direct pay 33d32acd51481b100fbaf43d6e5ffdbdec69d297cfe8e6b00ec02f0f16f7efe3. Chipnet: 7/7 attacks blocked and the full history in docs/chipnet-proof.md.

### [MAINNET] 10 calls · 2 txs
| Step | Tx | Result |
|---|---|---|
| Open | 2e6bc19dd27c3225981a4c24e66b8874325f9b3955baa0639d7218145a89d7e8 | 24,597 sats locked in the covenant |
| 10 calls | off-chain vouchers | 6,000 sats owed, 0 txs |
| Settle | fe4560302f626ee884f83f766e92544511ec824899014bb076d1deb91a8b64df | 5,451 to provider (after 549 fee), 18,597 back to owner |
| Fees | | 780 sats for the whole tab (open 231 + settle 549) vs ~2,260 if each of the 10 calls were its own ~226-byte payment |

## How it compares
| Approach | On-chain txs for N calls | Who can take unspent money |
|---|---|---|
| Pay per call (x402-bch exact, Satchel vault) | N | nobody, but N fees |
| Custodial prepaid tab / facilitator batch | 1 or few | the server or facilitator |
| **AgentTab `bch-credit`** | **2** | **nobody: the covenant refunds the owner** |

Credit: PSF `x402-bch` / `x402-bch-express` and OPTN Labs `x402-bch` (same HTTP flow; `bch-credit` sits next to their schemes in `accepts[]`). Payment-channel prior art: Streamium, CashCast.

## Architecture and stack
- `packages/covenant`: CashScript contract (176 bytes compiled, P2SH32), voucher signing (Schnorr datasig), tx builders.
- `packages/server`: x402 paywall (Node, TypeScript), tab ledger, settle/cancel ticker, chain replay after restarts.
- `packages/mcp`: MCP server for agents.
- `apps/web`: React + Vite + Tailwind, WizardConnect (Paytaca) for the human wallet.
- Tests: unit, property and HTTP tests, including a 500-step adversarial voucher stream.

## Screenshots (4+)
1. `desktop-chipnet-run-midway.jpg`: the receipt ticket mid-run, three paid calls, "0 on-chain txs".
2. `desktop-chipnet-settled.jpg`: SETTLED stamp, bar split "provider 3,000 / 17,000 back to you".
3. `desktop-attacks-7of7.jpg`: Try to cheat it, 7/7 cheats blocked, node error in the expander.
4. `desktop-mainnet-first-screen.jpg`: Mainnet default, "Give an AI agent a 5¢ tab" with the 20 Nov mainnet tab on the receipt.
5. `mobile-chipnet-settled.jpg`: the settled ticket on a phone.
6. `mainnet-tx-explorer.jpg`: the first real mainnet 1¢ payment (tx `33d32acd…f7efe3`) in a block explorer.
7. `mcp-fetch-paid.jpg`: Claude Code (MCP) calling `fetch_paid` against the hosted chipnet API: BCH price returned, 1,000-sat voucher on a new tab.

## Business model
API providers run a hosted AgentTab paywall and pay **1% of what their tabs settle**. Agents and their owners pay nothing extra, and settlement stays non-custodial: funds go from the covenant straight to the provider. The middleware, MCP server and SDK stay open source. No paying provider yet.

## Roadmap
- Propose `bch-credit` to the x402-bch maintainers.
- Next (not built yet): top-ups, multi-provider tabs, PUSD-denominated tabs.

## Why I built this
AI agents are starting to pay for APIs per request, and the usual options are one on-chain transaction and fee for every call, or a balance prepaid to the provider, where you trust its ledger for each charge and for your refund. I've built production AI agents and worked on stablecoin payments, and I wanted something in between: a bounded budget the agent can spend but can never run off with. AgentTab locks that budget in a Bitcoin Cash covenant with one transaction, pays for each call with a signed off-chain voucher, and settles with one more transaction, and the covenant forces whatever wasn't spent back to the owner. On chipnet the covenant rejected all 7 attacks in the app's test panel, and on 19 November 2026 a real wallet made a plain 1¢ payment for an oracle answer on BCH mainnet. On 20 November 2026 a full tab ran on mainnet: 10 paid calls, 2 transactions, and exactly 18,597 sats forced back to the owner.
