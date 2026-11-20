# Mainnet proof: AgentTab on BCH mainnet

## Mainnet covenant tab from a real Paytaca wallet (2026-11-20 10:46–10:47 UTC)

A visitor (the author's Paytaca wallet, over WizardConnect) funded a 5¢ tab on the live site; the hosted agent paid for 10 API calls with off-chain vouchers; the provider settled once. **10 paid calls, 2 on-chain transactions**, and the covenant forced the exact remainder back to the wallet.

| Step | Txid | What the chain shows |
|---|---|---|
| Open (owner locks 24,597 sats) | [`2e6bc19dd27c3225981a4c24e66b8874325f9b3955baa0639d7218145a89d7e8`](https://explorer.selene.cash/tx/2e6bc19dd27c3225981a4c24e66b8874325f9b3955baa0639d7218145a89d7e8?network=mainnet) | 24,597 sats to the AgentTab covenant (P2SH32) + change to the owner |
| 10 calls | none (off-chain vouchers, 1,000 sats each) | — |
| Settle | [`fe4560302f626ee884f83f766e92544511ec824899014bb076d1deb91a8b64df`](https://explorer.selene.cash/tx/fe4560302f626ee884f83f766e92544511ec824899014bb076d1deb91a8b64df?network=mainnet) | 5,451 sats to the provider (6,000 owed − 549-sat miner fee) and **exactly 18,597 sats back to the owner** (24,597 − 6,000) |

Hosted mainnet API: https://agenttab-api-mainnet.onrender.com (site: https://agenttab-bch.onrender.com, network **Mainnet**).

## 1¢ direct pay from a real Paytaca wallet (2026-11-19 10:47 UTC)

A human paid for one oracle answer with one plain on-chain payment, signed in Paytaca over WizardConnect and accepted at 0-conf.

| Step | Txid | Link |
|---|---|---|
| 1¢ direct pay: 4,797 sats to the provider + `OP_RETURN` invoice binding + change back to the payer | `33d32acd51481b100fbaf43d6e5ffdbdec69d297cfe8e6b00ec02f0f16f7efe3` | [view](https://explorer.bch.ninja/tx/33d32acd51481b100fbaf43d6e5ffdbdec69d297cfe8e6b00ec02f0f16f7efe3) |

Outputs checked on chain: 4,797 sats → provider `bitcoincash:qz9z7fakuqg98up40cgvg4ljxenk28hxwc703hq3k8` (the API's `direct.payTo`), one `OP_RETURN`, change to the payer.
