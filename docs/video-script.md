# Demo video script (target 1:40, hard limit 1:45)

Site: https://agenttab-wihk.onrender.com (opens on Mainnet). The free 5¢ demo runs at https://agenttab-wihk.onrender.com/?net=chipnet. Screen at 1440×900, light theme, browser zoom 110%. Voiceover is yours to say in your own words; the lines below are a guide, not a script to read.

The real run takes about 25 s from click to SETTLED. Cut the waits between calls in editing so the first 15 s show the whole arc.

| Time | Screen | Say (roughly) |
|---|---|---|
| 0:00–0:03 | `?net=chipnet` first screen: "A bar tab for AI agents." and the idle receipt ticket. | "This is an AI agent paying for API calls with Bitcoin Cash." |
| 0:03–0:06 | Click **Give an AI agent a 5¢ tab**. The coin chip lands in the ticket: "5¢ locked in tab · 20,000 sats", header "TAB #… open". | "One transaction locks 5 cents in a tab." |
| 0:06–0:12 | Three call lines fill in, `/api/oracle 402 → 200 +1,000`. Hold on "on-chain txs for these calls **0**" while the bar fills. | "Three paid calls. Zero on-chain transactions. Each one is a signed voucher, checked instantly." |
| 0:12–0:15 | The bar splits into "provider 3,000" and "17,000 back to you". The SETTLED stamp lands. CTA reads "Run it again", "3 calls · 2 transactions · 17,000 sats came back". | "It settles once, and the change comes back to me." |
| 0:15–0:30 | Stay on the settled ticket. Point at the proof strip under the hero. | "The problem: agents need to pay per request. A transaction per call is slow and costs a fee every time, and prepaying the API means trusting it with your money and your refund. AgentTab is a bar tab instead." |
| 0:30–0:50 | **How it works** tab: the three cards (Open: 1 tx / Pay per call: 0 tx / Close: 1 tx) and "Who can take what". | "The 5 cents sit in a CashScript covenant with three keys. The agent's key can only sign vouchers, never withdraw. When the tab closes, one transaction pays the provider exactly what the agent signed for, and the covenant forces the rest back to the owner. If the provider vanishes, the owner refunds after a timeout." |
| 0:50–1:10 | **Try to cheat it** tab → **Run the 7 attacks**. All rows show "trying", then "Rejected by node/server"; the counter reaches "7/7 cheats rejected". Open one expander (e.g. "Provider rewrites the signed amount") to show the node error in the mono box and "never entered the mempool". | "Can the provider overcharge, or the agent drain the tab? This fires seven real attacks at a fresh tab. The network rejects every one, and this is the node's own error. Then the honest settle goes through." |
| 1:10–1:25 | Switch the network to **Mainnet** (no query string). Hero button **Pay 1¢ for a live BCH price**; the ticket shows the last real mainnet payment with the PAID stamp. Click its tx link → explorer.bch.ninja tx `33d32acd…f7efe3`: 4,797 sats to the provider, an `OP_RETURN`, change to the payer. | "And it's live on mainnet. This is a real 1 cent payment from a Paytaca wallet over WizardConnect, accepted at zero-conf. The same tab flow is enabled on mainnet; the attack runs are on Chipnet because they spend coins." |
| 1:25–1:35 | **Use with your agent** tab: the MCP JSON with Copy, and "Your tabs" with Budget/Spent/Returned. | "Any MCP agent, like Claude, can use it as a tool. It speaks the x402 payment flow with one new scheme, bch-credit: batch settlement, but no facilitator holds the money." |
| 1:35–1:40 | Plain end card: site URL + GitHub link. | "Try it in 30 seconds at agenttab-wihk.onrender.com." [Author to write: one closing line of your own] |

## Shots to capture separately (for the BUIDL screenshots, 4+)
Already captured in `reviews/shots-r9-after/`:
1. `desktop-chipnet-run-midway.jpg`: ticket mid-run, call lines filling, "0 on-chain txs".
2. `desktop-chipnet-settled.jpg`: SETTLED stamp, "provider 3,000 / 17,000 back to you".
3. `desktop-attacks-7of7.jpg`: Try to cheat it, 7/7 rejected, one expander open.
4. `desktop-mainnet-first-screen.jpg`: Mainnet default, "Pay 1¢ for a live BCH price" and the PAID ticket.
5. `mobile-chipnet-settled.jpg`: the settled ticket on a phone.

Still to capture: the explorer page of mainnet tx `33d32acd51481b100fbaf43d6e5ffdbdec69d297cfe8e6b00ec02f0f16f7efe3`, and Claude Desktop with the MCP `fetch_paid` result.

## Before recording
- Open `?net=chipnet` once a minute before recording so the free-tier server is awake (otherwise "Waking the demo server (about 20 s)").
- Do one dry run of the 5¢ tab and of the 7 attacks; check the proof-strip counters don't go backwards on camera.
- Close other tabs and notifications; hide the bookmarks bar.
- Keep the total under 1:45 (judges give each project "a couple of minutes").
- Media track ($1k, judged on engagement): a 30–45 s vertical cut of 0:00–0:15 (click → coin → 3 calls at 0 txs → SETTLED, 17,000 back) plus the 7/7 attack run works as a separate post — your call, posted by you.
