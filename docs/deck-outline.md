# AgentTab: Widget Factory deck content (slide by slide)

Deck: https://docs.google.com/presentation/d/1HWXYkITgDgsd3Xc6NcHcST592q_E5ljSumN9d2bI-l4/edit

## Slide order (as built, 2026-11-19 redesign)

The deck follows the BLAZE template's order (Title, Name/one-liner, Story, Benefits, BCH Usage, Vision, Thank you)
in the site's dark tokens (`DESIGN.md`). Sections below are the source text; this is where each one lands. Every slide has a 0.5 s Fade (through black) transition and builds its key idea; explanations live in the speaker notes.

| # | Slide | Source section |
|---|---|---|
| 1 | Title: AgentTab, tagline, "Aakash Kumar · solo", settled receipt card (real chipnet run: open `dd59…32b8`, settle `4f57…2a16`) that builds line by line, 3 link chips (fire glow) | §1 |
| 2 | 100 paid API calls. 2 transactions. (per-call card, then AgentTab card) | §3 |
| 3 | The Story of AgentTab: pull quote; full "Why I built this" text in speaker notes | §9, §2 |
| 4 | Benefits: owner + agent → tab covenant → provider, built step by step: 1 tx / 0 tx / 1 tx | §4 |
| 5 | Benefits: every paid call, 0 on-chain txs (looping GIF of a live chipnet run in a browser frame) | §3 |
| 6 | BCH Usage 1/5: the 176-byte CashScript covenant (`settle()`, simplified) | §4 |
| 7 | BCH Usage 2/5: Try to cheat it, 7 / 7 rejected (rows build in sequence, ember-red REJECTED stamps, key error tokens; full strings in chipnet-proof) | §5 |
| 8 | BCH Usage 3/5: Live on BCH mainnet (light paper receipt card + explorer QR) | §8 |
| 9 | BCH Usage 4/5: Agents pay via MCP (3 lines) | §6 |
| 10 | BCH Usage 5/5: bch-credit vs per-call vs facilitator batch (3 tiles) | §6 |
| 11 | Business model: 1% provider take-rate | §7 |
| 12 | The Vision for AgentTab: timeline | §8 |
| 13 | Try it in 60 seconds: `?net=chipnet` + QR (fire glow) | §10 |
| 14 | Thank you (template mascot) | |


---

## 1. Title / one-liner
**AgentTab: a refundable tab for your AI agent, on Bitcoin Cash.**
One transaction to open, any number of paid API calls, one transaction to settle. Whatever isn't spent comes back to you.

- Live demo: https://agenttab-bch.onrender.com (opens on Mainnet; free 5¢ demo at `?net=chipnet`)
- Screenshot: `desktop-chipnet-settled.jpg` (the receipt ticket with the SETTLED stamp, "provider 3,000 / 17,000 back to you")
- Repo: https://github.com/Aakash074/agenttab
- Vote with EMBER2026: bitcoincash:zqcgm29z05erjdk440n6pj2vwmc8x5gxzcnwfnnrul

## 2. Problem
AI agents are starting to pay for APIs per call (x402).

- **Paying on-chain per call** costs a transaction and a fee every time. It adds latency to every request, and the agent holds a hot wallet that can spend everything.
- **Prepaid credit at the provider** is custodial. You trust the provider with your balance and your refund.
- I couldn't find a non-custodial way on BCH to give an agent a **bounded, refundable** budget that it can't run off with and the provider can't overcharge.

## 3. The number: 2 vs N
Screenshot: `desktop-chipnet-run-midway.jpg` (the ticket mid-run: three `402 → 200 +1,000` call lines while "on-chain txs for these calls" stays at **0**). Optionally crop in the proof strip under the hero (calls paid by agents · on-chain txs).

- **Per-call payments:** N calls means N transactions and N fees.
- **AgentTab:** N calls means **2 transactions** (open + settle). Each call is a signed voucher: instant, free, off-chain.

## 4. How it works
1. **Open:** the owner (a human wallet via WizardConnect, or the agent itself) locks a budget in the AgentTab covenant. The covenant names three keys: the owner, the agent (which can only sign vouchers) and the provider. The timeout is a block height.
2. **Pay per call:** the API answers `402 Payment Required` with the scheme `bch-credit`. The agent replies with `X-PAYMENT`, a voucher for the cumulative total, bound to this exact funding outpoint.
3. **Close:** there are three paths.
   - The provider **settles** once: it gets at most what was signed, and the owner gets **exactly** budget − amount.
   - The provider **cancels**: everything goes back to the owner.
   - After the timeout, the owner **refunds** everything.

(Diagram: wallet → covenant → API, vouchers on a dotted line, the two on-chain transactions as solid arrows. The site's **How it works** tab has the same three cards: Open: 1 tx / Pay per call: 0 tx / Close: 1 tx.)

## 5. "Try to cheat it" (judge-visible security)
Screenshot: `desktop-attacks-7of7.jpg` ("7/7 cheats rejected", one expander open with the node error and "never entered the mempool"). On the site's **Try to cheat it** tab, **Run the 7 attacks** opens a fresh tab and fires real attacks at it. Every one is rejected, and the reason shown is the chipnet node's own:

| Attack | Rejected with |
|---|---|
| Replay a used voucher | `402 replayed_voucher` |
| Provider overclaims | `Script failed an OP_VERIFY operation` |
| Provider rewrites the signed amount | `Signature must be zero for failed CHECK(MULTI)SIG` |
| Remainder sent elsewhere | `Script failed an OP_EQUALVERIFY operation` |
| Owner refunds early | `bad-txns-nonfinal` |
| Agent tries to withdraw | `Signature must be zero for failed CHECK(MULTI)SIG` |
| Provider "cancels" into its own wallet | `Script failed an OP_EQUALVERIFY operation` |

The test suite adds unit, property and HTTP tests, including a 500-step adversarial voucher stream.

## 6. Relationship to x402-bch
- AgentTab speaks the same HTTP flow as **x402-bch** (v2.2): `402` + `accepts[]`, an `X-PAYMENT` retry, and `X-PAYMENT-RESPONSE`.
- It adds one scheme, **`bch-credit`**: a non-custodial, covenant-backed tab instead of a per-request transaction or custodial batch debit.
- Credit: **Permissionless Software Foundation** (`x402-bch`, `x402-bch-express`) and **OPTN Labs** (`x402-bch`). `bch-credit` is designed to sit next to their schemes in the same `accepts[]`.
- An **MCP server** lets Claude or any MCP agent pay on its own: `fetch_paid`, `tab_status`, `close_tab`, `agent_info`, with spend caps. Screenshot: `mcp-fetch-paid.jpg` (a real Claude Code headless run on chipnet: price returned, 1,000-sat voucher).
- Closest rival in this hackathon: Satchel (capped covenant vault, payee allowlist, one on-chain tx per call). Say: "Vault = many payees, a tx per call. Tab = one API, thousands of calls, 2 txs." Credit them; don't knock them.
- Neighbour in this hackathon (say it if asked): LaunchDesk = a human pays an AI per job (escrow per order); AgentTab = an AI agent pays any API per call (one tab, many calls, 2 txs).
- Comparison table (copy from README "How it compares"): per-call payment = 100 txs per 100 calls; facilitator batch (Coinbase x402 batch, PSF batch debit) = few txs but the facilitator holds funds; `bch-credit` = 2 txs and no one can take the unspent budget. Line to say: "x402 batch settlement, trust-minimised on BCH L1: the covenant enforces the refund, no facilitator."

## 7. Business model
- **Provider take-rate:** API providers use a hosted AgentTab paywall and pay 1% of what their tabs settle.
- Agents and their owners pay nothing extra.
- Settlement stays non-custodial: funds go from the covenant straight to the provider.
- The middleware, MCP server and SDK stay open source.
- No paying provider yet.

## 8. Roadmap
- **Next concrete step:** propose `bch-credit` to the x402-bch maintainers (issue not opened yet).
- Mainnet: live since 2026-11-19 (first real Paytaca 1¢ payment, tx `33d32acd…f7efe3`, screenshot: `mainnet-tx-explorer.jpg`); the first mainnet covenant tab followed on 2026-11-20 (10 calls, 2 txs: open `2e6bc19d…`, settle `fe456030…`).
- Next (not built yet): top-ups, multi-provider tabs, PUSD-denominated tabs.

## 9. Why I built this
AI agents are starting to pay for APIs per request, and the usual options are one on-chain transaction and fee for every call, or a balance prepaid to the provider, where you trust its ledger for each charge and for your refund. I've built production AI agents and worked on stablecoin payments, and I wanted something in between: a bounded budget the agent can spend but can never run off with. AgentTab locks that budget in a Bitcoin Cash covenant with one transaction, pays for each call with a signed off-chain voucher, and settles with one more transaction, and the covenant forces whatever wasn't spent back to the owner. On chipnet the covenant rejected all 7 attacks in the app's test panel, and on 19 November 2026 a real wallet made a plain 1¢ payment for an oracle answer on BCH mainnet.

## 10. Try it in 60 seconds
1. Open https://agenttab-bch.onrender.com/?net=chipnet.
2. Press **Give an AI agent a 5¢ tab**.
3. Watch the receipt ticket: 3 paid calls, 0 on-chain txs, then SETTLED with 17,000 sats back to you.
4. Open the **Try to cheat it** tab → **Run the 7 attacks**.
5. On Mainnet (the default), **Pay 1¢ for a live BCH price** makes a real payment from Paytaca. Screenshot: `desktop-mainnet-first-screen.jpg`.
