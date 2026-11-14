# AgentTab: security notes

## What the covenant enforces

`packages/covenant/contracts/AgentTab.cash` is 126 bytes and has 68 opcodes.

**`settle(providerSig, voucher, amountBytes)`** has these requirements:
- **Shape:** exactly 1 input and exactly 2 outputs.
- **Provider signature:** `checkSig(providerSig, provider)`. Only the provider can settle.
- **Voucher signature:** `checkDataSig(voucher, "AGENTTAB" ‖ outpointTxHash ‖ outpointIndex(4) ‖ amountBytes, owner)`.
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
   - The server refuses tabs within `safetyBlocks` (6) of their timeout.
   - **TODO:** add an auto-settle job that closes tabs N blocks before timeout, and refuse vouchers once inside that window.
2. **No cooperative early close.** If the provider never settles, the owner's funds stay locked until `timeout`.
   - Keep timeouts short (for example 144 blocks, about 1 day).
   - A future `close(ownerSig, providerSig)` path could release funds early.
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
10. **Agent key is a hot key.** The owner key lives with the agent, so the budget is the maximum loss. Keep tabs small and short-lived.
11. **Strict two-output shape.** The settle tx can't carry an OP_RETURN memo. This is a deliberate choice for simplicity.
