# AgentTab design tokens

The deck, the video and the site all draw from this file. The code source is
[`apps/web/src/styles/tokens.css`](apps/web/src/styles/tokens.css); the background recipe and motion live in
[`apps/web/src/index.css`](apps/web/src/index.css).

The look is light, warm paper with one deep-teal accent and a receipt as the hero object. It is not neon, has no
gradients on text and uses no emoji. Light is the default; dark is opt-in.

## Colour

| Token | Light | Dark | Use |
|---|---|---|---|
| `ink` | `#F6F4EE` | `#070B0A` | Page background (warm paper) |
| `panel` | `#FFFFFF` | `#0E1513` | Cards, the receipt |
| `panel-2` | `#F1EEE6` | `#131C19` | Wells, tab bar, top banner |
| `line` | `#E3DED2` | `#1E2B27` | Card borders |
| `line-2` | `#CDC6B6` | `#2A3A35` | Control borders, receipt perforations |
| `fg` | `#111A17` | `#E8F3EF` | Primary text |
| `muted` | `#44514C` | `#A3B8B1` | Body copy |
| `dim` | `#5C6964` | `#8AA098` | Captions, labels |
| `bch` (accent) | `#0E6B60` | `#4CC3B0` | Primary button, bars, coin, dots |
| `bch-hover` | `#0A564D` | `#7AD8C9` | Primary button hover |
| `on-bch` | `#FFFFFF` | `#04201C` | Text on the accent |
| `bch-2` (accent as text) | `#0E6B60` | `#6FD3C3` | Links, `200`, SETTLED stamp |
| `warn` | `#8A5300` | `#F5B84B` | Reconnecting, hiccups |
| `bad` | `#B42318` | `#F2716B` | Errors, cheats that got through |
| `gold` | `#7A5200` | `#F3CF6A` | Second coin-burst colour |

Contrast on paper `#F6F4EE` (WCAG): fg 16.1:1, muted 7.6:1, dim 5.2:1, accent text 5.8:1, white on the accent 6.4:1.
In dark, fg is 17.4:1, muted 9.5:1, dim 7.1:1 and accent text 11.1:1. Every text pair passes AA.

## Type

Both families come from Google Fonts.

- **Inter** (400 / 500 / 600 / 700 / 800) for the UI.
- **JetBrains Mono** (400 / 500 / 600) for the receipt, txids, code and numbers on the slip.

| Role | Font | Size / line-height | Weight | Notes |
|---|---|---|---|---|
| Hero headline | Inter | 58px desktop, 52px tablet, 40px phone; lh 1.04 | 800 | Tracking −0.025em |
| Hero lead | Inter | 18px; lh 1.625 | 400 | `muted` |
| Section title | Inter | 18px | 600 | |
| Body | Inter | 15px / 14px | 400 | |
| Primary button | Inter | 16px; 52px tall | 600 | Radius 12px |
| Header controls (network, Connect, wallet) | Inter | 14px; 40px tall | 600 | Radius 8px |
| Tabs | Inter | 14px; 44px tall | 500 | |
| Banner, captions | Inter | 12.5px / 12px | 400–500 | |
| Receipt header (`AGENTTAB`, `TAB #…`) | JetBrains Mono | 13px | 600 | Tracking 0.2em on `AGENTTAB` |
| Receipt rows | JetBrains Mono | 12.5px | 400 | |
| Receipt total | JetBrains Mono | 24px | 700 | Tabular numbers |
| Receipt small print | JetBrains Mono | 11.5px | 400 | |
| Stamp (`SETTLED` / `PAID`) | JetBrains Mono | 12px | 700 | Tracking 0.18em, 2px border, rotated −6° |

## Radii, spacing, elevation

- **Radii:** 8px for controls and small buttons, 10px for the receipt, 12px for the primary button and wells, 16px for cards, and pills are fully round.
- **Layout:** content is at most 1152px wide (`max-w-6xl`) with 16px side gutters. The hero is two columns, copy and a 430px receipt with a 56px gap, and stacks on a phone.
- **Card shadow:** `0 1px 2px rgb(17 26 23 / .06), 0 1px 1px rgb(17 26 23 / .04)`.
- **Receipt lift** (light), four stacked layers, the last tinted with the accent:
  `0 1px 1px rgb(17 26 23/.04), 0 2px 4px -1px rgb(17 26 23/.05), 0 10px 20px -6px rgb(17 26 23/.08), 0 28px 56px -16px rgb(14 107 96/.22)`.
- **Primary hover:** the button rises 1px over `0 6px 16px -6px rgb(14 107 96/.45)` and presses to 98%.

## Background recipe

There are four layers, back to front. Only the glow moves, and nothing moves under `prefers-reduced-motion`.

1. **Paper:** the `ink` colour on `html`.
2. **Grain:** a 160px SVG `feTurbulence` tile (fractalNoise, baseFrequency 0.8, 3 octaves, grayscale), fixed to the viewport. In light it is a pale tile (`.6·noise + .17`) multiplied at 40%, which reads as paper tooth. In dark it is a mid-grey tile (`.6·noise − .4`) soft-lit at 60%.
3. **Teal glow:** radial gradients on the hero, drifting over 38s (ease-in-out, alternate, at most ±2.5% translate and 4% scale).
   - Teal `rgb(14 107 96 / .13)` centred behind the receipt (72% / 36%).
   - Warm `rgb(196 150 60 / .07)` at the top left.
   - A fainter teal under the headline.
   - In dark the glow is `rgb(76 195 176 / .11)`.
4. **Dot grid:** 1px dots on a 22px grid (`rgb(17 26 23 / .11)`; dark `rgb(232 243 239 / .075)`), masked by an ellipse so it fades out towards the edges and below the hero.

## The receipt-ticket motif

The receipt is the product's hero object: a paper slip in mono type that fills in live.

- **Shape:** a white slip with a 10px radius and a 1px `line` border, lifted by the receipt shadow.
- **Perforations:** three tear lines, each a 2px dashed `line-2` rule inset 14px. Each tear line has a punched half-circle notch (16px) at both ends, filled with the page colour.
- **Rows:** in order, header (`AGENTTAB` · `TAB #ABCD`), status, `locked in tab`, up to three `/api/oracle 402 → 200  +1,000` rows, `on-chain txs for these calls  0`, then **Total** with a spend bar (accent for provider, `fg/25` for change back), and the open/settle txids.
- **Motion:**
  - The 5¢ coin flies in when the tab opens (400ms), then bursts into eight specks.
  - Each paid call slides in (300ms) and bursts eight teal/gold specks off the total, which counts up and nudges 1px.
  - The `0` on-chain counter pulses.
  - `SETTLED` stamps in at −6°.
- **Burst:** eight 4–5px dots, accent / gold / pale accent, flying 18–38px out over 700ms and fading. The burst is hidden under reduced motion.

## Motion rules

- **Durations:** 150–400ms with ease-out (`cubic-bezier(.2,.7,.3,1)`). The exceptions are the 700ms burst and the 38s ambient drift.
- **Micro-interactions:** buttons press to 98%. Header controls darken their border and fill on hover. Inactive tabs get a `subtle` fill on hover, and the tab indicator slides in 250ms.
- **Reduced motion:** `prefers-reduced-motion: reduce` disables every animation and transition and hides the burst.
