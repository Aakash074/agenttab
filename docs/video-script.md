# Demo video script (target 1:45, hard limit under 2:00)

Record after the mainnet deploy (hosted URL + one real mainnet open/settle). Screen at 1440×900, light theme, browser zoom 110%. Voiceover is yours to say in your own words; the lines below are a guide, not a script to read.

| Time | Screen | Say (roughly) |
|---|---|---|
| 0:00–0:12 | Split screen. Left: Claude Desktop calling the MCP tool `fetch_paid`. Right: AgentTab feed, a new row "PAID CALL · just now" appears. | "This is Claude paying for an API call with Bitcoin Cash. No account, no API key, no transaction per call." |
| 0:12–0:25 | Hero + "Give an AI agent a 5¢ tab" button. | "The problem: agents need to pay per request, but a blockchain transaction per call is slow, and a prepaid account means trusting the API with your money. AgentTab is a bar tab instead." |
| 0:25–0:50 | Press the button. Paytaca (WizardConnect) approves the open. The tab card appears, budget meter drains as 3 calls run. | "I lock 5 cents in a CashScript covenant. The agent pays each call with a signed voucher, checked instantly, off-chain. Watch the budget go down." |
| 0:50–1:05 | Settle row → click the txid → explorer shows exactly two outputs. | "When the tab closes, one transaction pays the provider what the agent signed for, and the rest comes back to me. Two transactions for any number of calls." |
| 1:05–1:25 | Scroll to "Try to cheat the tab" → Run 7 attacks → seven REJECTED with node errors, then the honest settle accepted. | "Can the provider overcharge, or the agent drain it? We try seven attacks against a real tab. The network rejects every one." |
| 1:25–1:38 | README "How it compares" table (per-call vs facilitator batch vs bch-credit). | "It speaks the x402 payment flow, with one new scheme, bch-credit. Like batch settlement, but no facilitator holds the money: the covenant enforces the refund." |
| 1:38–1:45 | Hosted URL + GitHub link on a plain end card. | "Try it yourself in 60 seconds at [hosted URL]." [Author to write: one closing line of your own] |

## Shots to capture separately (for the BUIDL screenshots, 4+)
1. Hero with a fresh receipt ("TAB #xxxx", SETTLED stamp).
2. Tab card mid-spend (budget meter partly drained) next to the live feed.
3. Attack panel with 7/7 REJECTED.
4. Explorer page of a mainnet settle showing the two outputs.
5. Claude Desktop with the MCP `fetch_paid` result.

## Before recording
- Mainnet tab funded from Paytaca (H11 done), hosted URL live, demo agent running.
- Close other tabs and notifications; hide bookmarks bar.
- Do one dry run; keep total under 2:00 (judges give each project "a couple of minutes").
- Media track ($1k, judged on engagement): a 30–45 s vertical cut of 0:00–0:50 + the attack panel works as a separate post — your call, posted by you.
