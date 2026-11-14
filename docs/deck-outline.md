# AgentTab: Widget Factory deck content (slide by slide)

This is the text to paste into the user's copy of the BLAZE Widget Factory template. Keep the template's layout. Slides marked **HUMAN** must be written by the author.

---

## 1. Title / one-liner
**AgentTab: a refundable tab for your AI agent, on Bitcoin Cash.**
One transaction to open, any number of paid API calls, one transaction to settle. Whatever isn't spent comes back to you.

- Live demo: <hosted URL> (mainnet + chipnet)
- Repo: https://github.com/Aakash074/agenttab
- Vote with EMBER2026: bitcoincash:zqcgm29z05erjdk440n6pj2vwmc8x5gxzcnwfnnrul

## 2. Problem
AI agents are starting to pay for APIs per call (x402).

- **Paying on-chain per call** costs a transaction and a fee every time. It adds latency to every request, and the agent holds a hot wallet that can spend everything.
- **Prepaid credit at the provider** is custodial. You trust the provider with your balance and your refund.
- There is no way to give an agent a **bounded, refundable** budget that it can't run off with and the provider can't overcharge.

## 3. The number: 2 vs N
Put the live counter from the site here as a screenshot: "N API calls paid · 2 on-chain txs per tab · total fees $X".

- **Per-call payments:** N calls means N transactions and N fees.
- **AgentTab:** N calls means **2 transactions** (open + settle). Each call is a signed voucher: instant, free, off-chain.

## 4. How it works
1. **Open:** the owner (a human wallet via WizardConnect, or the agent itself) locks a budget in the AgentTab covenant. The covenant names three keys: the owner, the agent (which can only sign vouchers) and the provider. The timeout is a block height.
2. **Pay per call:** the API answers `402 Payment Required` with the scheme `bch-credit`. The agent replies with `X-PAYMENT`, a voucher for the cumulative total, bound to this exact funding outpoint.
3. **Close:** there are three paths.
   - The provider **settles** once: it gets at most what was signed, and the owner gets **exactly** budget − amount.
   - The provider **cancels**: everything goes back to the owner.
   - After the timeout, the owner **refunds** everything.

(Diagram: wallet → covenant → API, vouchers on a dotted line, the two on-chain transactions as solid arrows.)

## 5. "Try to cheat the tab" (judge-visible security)
Put a screenshot of the panel here. A press opens a fresh tab and fires real attacks at it. Every one is rejected, and the reason shown is the chipnet node's own:

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
- Credit: **Permissionless Software Foundation** (`x402-bch`, `x402-bch-express`) and **OPTN Labs** (`x402-bch`, AI allowance covenants). `bch-credit` is designed to sit next to their schemes in the same `accepts[]`.
- An **MCP server** lets Claude or any MCP agent pay on its own: `fetch_paid`, `tab_status`, `close_tab`, `agent_info`, with spend caps.

## 7. Business model
- **Who pays:** API providers want to sell per call to agents without card rails or custody, and the end users who fund their agents.
- **Hosted paywall (SaaS):** "AgentTab for your API". We run the 402 / voucher verification, auto-settle and dashboard.
  - A take-rate of 1–2% on settled volume, or a flat monthly fee for high volume.
  - Settlement stays non-custodial: funds move covenant → provider.
- **Open-source middleware:** free (Express/Hono/Node), which drives adoption of the scheme.
- **Agent side:** the MCP server and SDK are free. A possible premium tier adds managed agent wallets with spend policies.
- **Why BCH:** sub-cent fees and fast 0-conf make a 2-transaction channel cheap to open and close, and covenants enforce the refund.

## 8. Roadmap
- **Now:** mainnet launch with Paytaca over WizardConnect; hosted demo; MCP server.
- **Next:** PUSD-denominated tabs (CashTokens) for dollar-priced APIs; tab top-ups; multi-provider tabs; an Express/Hono middleware package.
- **Later:** a standard proposal for `bch-credit` alongside x402-bch; a provider dashboard and analytics; agent marketplace integrations.

## 9. Why I built this — **HUMAN**
<!-- HUMAN: write in your own words: what got you interested, what you learned about BCH covenants, why this matters to you. -->

## 10. Try it in 60 seconds
1. Open <hosted URL>.
2. Press **"Give an AI agent a 5¢ tab…"**.
3. Watch 3 paid calls, then get your change back.
4. Scroll to **Try to cheat the tab**.
