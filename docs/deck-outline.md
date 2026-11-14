# AgentTab: Widget Factory deck content (slide by slide)

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
- I couldn't find a non-custodial way on BCH to give an agent a **bounded, refundable** budget that it can't run off with and the provider can't overcharge.

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
- Credit: **Permissionless Software Foundation** (`x402-bch`, `x402-bch-express`) and **OPTN Labs** (`x402-bch`). `bch-credit` is designed to sit next to their schemes in the same `accepts[]`.
- An **MCP server** lets Claude or any MCP agent pay on its own: `fetch_paid`, `tab_status`, `close_tab`, `agent_info`, with spend caps.
- Comparison table (copy from README "How it compares"): per-call payment = 100 txs per 100 calls; facilitator batch (Coinbase x402 batch, PSF batch debit) = few txs but the facilitator holds funds; `bch-credit` = 2 txs and no one can take the unspent budget. Line to say: "x402 batch settlement, trust-minimised on BCH L1: the covenant enforces the refund, no facilitator."

## 7. Business model
- No paying provider yet.
- First guess: a hosted paywall for API providers, charging 1% of settled volume [Author to confirm].
- Settlement stays non-custodial: funds go from the covenant straight to the provider.
- The middleware, MCP server and SDK stay open source.
- Who pays is open: the API provider (take-rate) or the agent owner (nothing extra today) [Author to confirm].

## 8. Roadmap
- **Next concrete step:** propose `bch-credit` to the x402-bch maintainers (issue not opened yet).
- Mainnet launch with a real Paytaca wallet over WizardConnect (pending hosting).
- Possible later: PUSD-denominated tabs, tab top-ups, multi-provider tabs [Author to confirm].

## 9. Why I built this
[Author to write]

## 10. Try it in 60 seconds
1. Open <hosted URL>.
2. Press **"Give an AI agent a 5¢ tab…"**.
3. Watch 3 paid calls, then get your change back.
4. Scroll to **Try to cheat the tab**.
