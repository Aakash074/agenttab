# Deploying AgentTab (Vercel + Render free)

Update 2026-11-15: the user created Render + Vercel accounts. Step 1 deploys `render.yaml` (chipnet API + static web, both on Render free). Keys come from a Render-generated `KEY_SEED` (server derives each role key), so no WIF is typed into a dashboard. Fund the derived faucet/demo addresses (shown at `/.well-known/agenttab` and the faucet route) with chipnet coins. The mainnet API is added only after the user's chipnet Paytaca test passes.

## API servers on Render (`render.yaml`)

`render.yaml` defines two services: `agenttab-api-chipnet` and `agenttab-api-mainnet`.

1. In Render, choose **New → Blueprint** and point it at `github.com/Aakash074/agenttab`.
2. Set the secret env vars in the dashboard (`sync: false` in the blueprint):

| Service | Variable | Value |
|---|---|---|
| chipnet | `PROVIDER_WIF`, `DEMO_AGENT_WIF`, `FAUCET_WIF`, `ATTACK_OWNER_WIF` | Throwaway **testnet** WIFs. Generate them with `node packages/covenant/scripts/keygen.ts` in a scratch dir, then fund FAUCET, DEMO_AGENT and ATTACK_OWNER with free chipnet coins (`packages/server/scripts/faucet-topup.ts`). |
| mainnet | `PROVIDER_WIF` | A **mainnet** WIF for a fresh key that only *receives* settlements. Never the user's main wallet. |
| mainnet | `DEMO_AGENT_WIF` | A fresh **mainnet** WIF. It needs no funds, because on mainnet the demo agent only spends tabs that visitors fund for it (capped by `DEMO_MAINNET_MAX_TOTAL_SATS`, default 50k sats). |

3. **Free-plan caveats:**
   - **Services sleep after about 15 min idle.** `.github/workflows/keepalive.yml` pings `/.well-known/agenttab` every 10 minutes. Set the repo variables `AGENTTAB_API_CHIPNET` and `AGENTTAB_API_MAINNET` to the Render URLs.
   - **The disk is ephemeral.** `.data/tabs-*.json` (the feed, tab records and the highest voucher per tab) is lost on redeploy or restart.
     - On chipnet that's acceptable.
     - On mainnet, an unsettled tab's highest voucher would be lost on restart. The owner can still refund after the timeout, so the provider loses revenue but the user loses nothing.
     - Mitigations: keep tabs short (12 blocks), let the server auto-close before restarts, or add a Render disk (paid) or a small KV store.
   - **Restarts lose state.** The rate limiters are in memory.

## Web on Vercel (`apps/web/vercel.json`)

1. Choose **New Project → Import** `Aakash074/agenttab`.
2. Set **Root Directory** to `apps/web`. The framework is Vite; the install runs from the repo root because of npm workspaces.
3. Set these env vars:

| Variable | Value |
|---|---|
| `VITE_SERVER_URL_CHIPNET` | `https://agenttab-api-chipnet.onrender.com` (no trailing slash) |
| `VITE_SERVER_URL_MAINNET` | `https://agenttab-api-mainnet.onrender.com` (setting it enables Mainnet in the selector) |
| `VITE_DEMO_AGENT_PUB` | Optional; the server's `/.well-known/agenttab` already advertises it. |
| `VITE_DECK_URL` | The Widget Factory deck copy (Google Slides share link). |
| `VITE_REPO_URL` | `https://github.com/Aakash074/agenttab` |
| `VITE_PROTOTYPE_URL` | `https://github.com/Aakash074/agenttab-prototype` |
| `VITE_DONATION_ZADDR` | `bitcoincash:zqcgm29z05erjdk440n6pj2vwmc8x5gxzcnwfnnrul` |

The API sends `access-control-allow-origin: *`, and the live feed uses SSE, which works cross-origin.

## First mainnet transaction (the user does this)

1. Open the Vercel URL and switch the network to **Mainnet**.
2. Press the one-button journey, choose **WizardConnect**, and scan with Paytaca.
3. Approve the open-tab transaction (about 5¢). The demo agent pays 3 calls (600 sats each) from the tab, then the tab is closed and the change comes back.
4. Record the open and settle txids in `docs/mainnet-proof.md`.
