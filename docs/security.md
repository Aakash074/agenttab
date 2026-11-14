# AgentTab: security notes

## What the covenant enforces

`packages/covenant/contracts/AgentTab.cash` is 127 bytes. Its constructor is `AgentTab(owner, agent, provider, timeout)`. The `owner` funds the tab, receives the remainder, and is the only key that can refund. The `agent` key can only sign vouchers.

**`settle(providerSig, voucher, amountBytes)`** has these requirements:
- **Shape:** exactly 1 input and exactly 2 outputs.
- **Provider signature:** `checkSig(providerSig, provider)`. Only the provider can settle.
- **Voucher signature:** `checkDataSig(voucher, "AGENTTAB" ‖ outpointTxHash ‖ outpointIndex(4) ‖ amountBytes, agent)`.
  - The voucher is bound to the exact funding outpoint.
  - The domain tag stops the signature being reused in another context.
- **Bounds:**
  - `amount >= 546`
  - `budget − amount >= 546`, so neither output is dust.
- **Output 0:** P2PKH(provider), with `value <= amount` and no tokens. The provider pays the miner fee from its own share.
- **Output 1:** P2PKH(owner), with `value == budget − amount` exactly and no tokens.

**`refund(ownerSig)`** has two requirements:
- the owner's signature;
- `tx.time >= timeout`. This is an absolute nLockTime, so the node enforces finality.

## Attacks and how they're handled

| Attack | Result | Test |
|---|---|---|
| The provider takes more than the voucher | Rejected (output 0 must be `<= amount`) | covenant: overclaim ×2 |
| The provider edits `amountBytes` | Rejected (the datasig no longer matches) | covenant: "bumps the amount argument" |
| The owner gets less than `budget − amount` | Rejected (must be an exact match) | covenant: owner shortchanged |
| Provider's share or owner's remainder sent to a third address | Rejected | covenant: wrong destination ×2 |
| An extra output siphons value | Rejected (exactly 2 outputs) | covenant: extra output |
| A forged voucher (wrong key) | Rejected | covenant and server |
| A voucher signed by the owner instead of the agent key | Rejected | covenant |
| The agent key tries to refund or withdraw | Rejected | covenant |
| A third party settles without the provider key | Rejected | covenant |
| A voucher replayed on another tab, or on a second utxo at the same address | Rejected (the voucher is bound to the outpoint, not to the address or bytecode) | covenant: outpoint binding |
| Two tab utxos merged into one settle to pay once and take both | Rejected (exactly 1 input) | covenant: bundle |
| Early refund | Rejected by the script locally, and by the chipnet node as "non-final" | covenant, plus `docs/chipnet-proof.md` |
| The provider uses the refund path | Rejected | covenant |
| An old or used voucher replayed against the API | Rejected (`replayed_voucher`; each request needs exactly `previous + price`) | server |
| Concurrent requests carrying the same voucher | Only one succeeds (the check-and-update is synchronous) | server |
| Spending past the budget | Rejected (`budget_exhausted` at `budget − 546`) | server |

## Known weaknesses and trade-offs

1. **Timeout race.** After `timeout`, the owner can refund everything, including value already covered by vouchers. The provider must settle before then.
   - The server refuses vouchers inside the `SAFETY_BLOCKS` window (6 blocks).
   - `tick()` auto-settles any tab inside that window.
   - If the server is down for the whole window, the provider loses that revenue.
2. **Early close needs the provider.** `cancel(providerSig)` (covenant v3) lets the provider return the whole budget at once. The server also uses it automatically when too little is owed to settle. If the provider never settles or cancels, the owner waits for `timeout`, so keep timeouts short (12 blocks in the one-button flow). Even when cancelling, the provider can burn at most the 1000-sat fee cap from the owner's refund.
3. **Pay-before-serve exposure: one call.** The voucher travels with the request, so a provider that takes the voucher and fails to serve gains at most `price` (one call). The owner can stop at any time.
4. **Opening at 0-conf.** Until the funding tx confirms, the owner could double-spend it. The provider then loses whatever it served against that tab.
   - BCH 0-conf plus double-spend proofs makes this hard. Even so, high-value providers should require 1 confirmation before `register`.
   - Txid malleability of the funding tx would also invalidate outpoint-bound vouchers. This hurts the provider, not the owner, and is moot because CashScript signs with Schnorr and BCH enforces strict-DER, low-S and clean-stack rules.
5. **Fee griefing.**
   - **Owner side:** not possible. The fee comes out of the provider's share and the owner's remainder is exact.
   - **Provider side:** a very small tab, where `amount − fee < 546`, can't be settled profitably. Use budgets of at least a few thousand sats.
6. **One utxo per tab.** A second payment to the same contract address is not part of the tab. Vouchers can't touch it, and the owner can only recover it via `refund` after `timeout`. The SDK always opens a new tab instead of topping up.
7. **Timestamp timeouts lag about 1 hour.** Timestamp timeouts compare against median-time-past. Use block-height timeouts (all the demos do).
8. **Provider sighash.** The provider can sign with any sighash type. A weak sighash only lets third parties reshuffle the provider's own output inside the covenant's limits, so the owner is never affected.
9. **Server state is the provider's money.** Losing `.data/tabs.json` loses only unsettled revenue. Owners are not at risk.
10. **The MCP client trusts the provider's count when adopting a human-funded tab.** It takes the provider's `highest` voucher as its starting point. A malicious provider could inflate that number to make the agent sign more.
    - The agent's per-call price cap and total spend cap bound the damage.
    - The owner sees spent vs. budget in the web UI.
    - Tabs the agent opens itself are counted only from local state.
11. **Agent key is a hot key.** The agent key lives with the agent. It can only sign vouchers, so the tab budget is the most it can lose. Keep tabs small and short-lived.
12. **Strict two-output shape.** The settle tx can't carry an OP_RETURN memo. This is a deliberate choice for simplicity.

13. **WizardConnect refund is not yet tested with a real wallet.** The refund tx spends a contract input that needs the owner's signature, which the wallet has to fill into a placeholder. Whether Paytaca signs contract inputs over WizardConnect has not been verified. The open-tab flow is the plain P2PKH case.
14. **Hosted demo agent and drip faucet.** Both are convenience features for judges, and both are chipnet-only by default.
    - **Demo agent:** its key sits on the server and its spend is bounded by its tab budget. It can pay from a visitor's tab only if the visitor named the demo agent as that tab's agent.
    - **Drip faucet:** sends free test coins from a server key. It is limited per address, per IP and globally, and refuses to start on mainnet.
    - Rate limits are in-memory and reset on restart.
15. **Render free hosting is ephemeral.** A restart loses the server's record of the highest voucher. The owner never loses: they refund at the timeout. The provider can lose unsettled revenue, so keep tabs short. See `docs/deploy.md`.
