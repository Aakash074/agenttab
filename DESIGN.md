# AgentTab design tokens

The deck, the video and the site all draw from this file. The code source is
[`apps/web/src/styles/tokens.css`](apps/web/src/styles/tokens.css); the background recipe and motion live in
[`apps/web/src/index.css`](apps/web/src/index.css) and the moving parts in
[`apps/web/src/components/Backdrop.tsx`](apps/web/src/components/Backdrop.tsx).

The look is light, warm paper with one deep-teal accent, a slow teal aurora and a receipt as the hero object. It is not
neon, has no gradients on text and uses no emoji. Light is the default; dark is opt-in.

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
| `dim` | `#55625D` | `#8AA098` | Captions, labels |
| `bch` (accent) | `#0E6B60` | `#4CC3B0` | Primary button, bars, coin, dots |
| `bch-hover` | `#0A564D` | `#7AD8C9` | Primary button hover |
| `on-bch` | `#FFFFFF` | `#04201C` | Text on the accent |
| `bch-2` (accent as text) | `#0B5D54` | `#6FD3C3` | Links, `200`, SETTLED stamp |
| `warn` | `#8A5300` | `#F5B84B` | Reconnecting, hiccups |
| `bad` | `#B42318` | `#F2716B` | Errors, cheats that got through |
| `gold` | `#7A5200` | `#F3CF6A` | Second coin-burst colour |

Contrast on paper `#F6F4EE` (WCAG): fg 16.1:1, muted 7.6:1, dim 5.8:1, accent text 7.0:1, white on the accent 6.4:1.
In dark, fg is 17.4:1, muted 9.5:1, dim 7.1:1 and accent text 11.1:1. Every text pair passes AA.
`dim` and accent text were darkened so they keep AA over the aurora tint. Measured over the whole page, on every tab, at
1440, 1280 and 390px and across the animation cycle, the worst text against its background is 4.7:1 in light and
5.3:1 in dark.

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
- **Cards:** every panel uses one style shared with the receipt. Steps, covenant, feed, cheat list, MCP, your tabs and Advanced all get the `panel` colour, the receipt's paper-fibre texture, a 1px `line` border, a 16px radius and a layered shadow:
  `0 1px 1px rgb(17 26 23/.04), 0 2px 4px -1px rgb(17 26 23/.05), 0 10px 24px -12px rgb(17 26 23/.10), 0 24px 48px -24px rgb(14 107 96/.16)`.
  Interactive cards (`.card-lift`) rise 2px on hover onto a deeper shadow, and their border darkens to `line-2`. In dark, the shadows are black, with the last layer `rgb(76 195 176/.16)`.
- **Step icons:** a 34px tile with a 10px radius. It is filled with the accent at 11% over `panel`, has a 1px inset ring of the accent at 22%, and holds an 18px line icon (1.8 stroke) in accent text: lock (open), receipt (pay per call), check-loop (close), shield (who can take what).
- **Transaction chips** (`.chip-tx`) look like a receipt line: JetBrains Mono at 11.5px/600, 24px tall, 6px radius, a dashed `line-2` border on `panel-2`. A `0 tx` chip is accent-tinted.
- **Glass:** the sticky header (banner and nav together), the tab bar, the footer and the link chips sit on `ink` at 72% (55% for the footer) with a 14px blur and 1.5 saturation, over a `rgb(17 26 23/.08)` hairline. In dark this is `ink` at 68% over `rgb(232 243 239/.07)`. Once the page scrolls, the header gains `0 10px 28px -14px` shadow.
- **Footer:** a short description, a mono stack line and pill chips for Deck, Source, Prototype (disclosure) and Vote. The Vote chip copies the z-address. On phones a theme chip is added.
- **Receipt lift** (light): an inner top highlight, a hairline, a contact shadow, two ambient layers and two accent-tinted layers:
  `inset 0 1px 0 rgb(255 255 255/.7), 0 0 0 1px rgb(17 26 23/.02), 0 1px 1px rgb(17 26 23/.06), 0 3px 6px -2px rgb(17 26 23/.08), 0 12px 24px -8px rgb(17 26 23/.10), 0 30px 50px -16px rgb(14 107 96/.22), 0 60px 100px -30px rgb(14 107 96/.32)`.
  In dark: `inset 0 1px 0 rgb(255 255 255/.05), 0 0 0 1px rgb(255 255 255/.03), 0 2px 4px rgb(0 0 0/.4), 0 16px 32px -10px rgb(0 0 0/.65), 0 40px 80px -24px rgb(76 195 176/.26)`.
- **Primary hover:** the button rises 1px over `0 6px 16px -6px rgb(14 107 96/.45)` and presses to 98%.

## Background recipe

There are six hero layers, back to front, and a page layer that carries the look down to the footer. The look must read at a glance (a judge should see teal light and a grid, not
plain beige) while text keeps AA. Nothing moves under `prefers-reduced-motion`; everything pauses when the tab is hidden
or the hero is off screen.

1. **Paper:** the `ink` colour on `html`.
2. **Grain:** a 160px SVG `feTurbulence` tile (fractalNoise, baseFrequency 0.8, 3 octaves, grayscale), fixed to the
   viewport. In light it is a pale tile (`.6·noise + .17`) multiplied at 40%, which reads as paper tooth. In dark it is a
   mid-grey tile (`.6·noise − .4`) soft-lit at 60%.
3. **Aurora mesh:** five soft radial blobs on one canvas drawn at 1/8 resolution, upscaled by CSS and redrawn at 20 Hz (the coins move on the same tick).
   Each blob drifts on its own 43–89s sine loops (about ±35% of its radius, ±10% scale). The mesh fades out over the
   bottom 40% of the hero.

   | Blob | Light | Dark | Where |
   |---|---|---|---|
   | 1 deep teal | `rgb(14 107 96 / .30)` | `rgb(76 195 176 / .20)` | behind the receipt, top right |
   | 2 mint | `rgb(64 178 160 / .30)` | `rgb(30 140 125 / .30)` | lower right |
   | 3 warm | `rgb(196 150 60 / .16)` | `rgb(243 207 106 / .07)` | top left |
   | 4 blue-teal | `rgb(20 120 132 / .10)` | `rgb(60 150 190 / .12)` | under the headline, kept low because text sits on it |
   | 5 deep teal | `rgb(14 107 96 / .24)` | `rgb(76 195 176 / .15)` | the left margin, balancing the receipt glow |

   Gradient stops are the colour at 0, 45% of its alpha at 55%, and transparent at 100%.
4. **Grid:** 1px lines on a 44px grid (light `rgb(14 107 96 / .085)`, dark `rgb(111 211 195 / .065)`) with a 1.2px dot on
   every intersection (light `rgb(17 26 23 / .18)`, dark `rgb(232 243 239 / .16)`). An ellipse mask
   (72% × 56% at 60% / 32%) fades it out towards the edges and below the hero.
5. **Cursor spotlight** (fine pointer, 768px and wider): a 520px soft disc that follows the cursor over the hero. It
   holds a light tint (light `rgb(14 107 96 / .08)`, dark `rgb(76 195 176 / .10)`) and a brighter copy of the grid
   (`.22` alpha), aligned exactly to the base grid, so the grid lights up under the pointer.
6. **Drifting coins:** five BCH coins (20–30px). Each is an accent disc with a dashed milled rim and a ₿ tilted −14°, drawn
   as SVG in `on-bch`, with a soft accent glow. They sit only in the page margins, below the header and never under text
   or the receipt. They drift 22px up and sway ±10° over 23–34s, ping-ponging. The two nearest the content are hidden
   below 1440px, and all of them below 1240px (phones get none).
7. **Page layer** (below the hero): the same 44px grid at about half strength (lines `.05`, dots `.10`; dark `.04`/`.09`)
   fades in from 820px to 1150px and out before the page ends. Four static glows alternate left and right behind the
   tabs, cards and footer (`rgb(14 107 96 / .10)` and `rgb(64 178 160 / .13)`; dark `rgb(76 195 176 / .07)` and
   `rgb(30 140 125 / .13)`). It has no animation, so it costs one paint.

**Parallax:** the layers move at different depths. With the pointer at −1…1 across the viewport and `sy` as the scroll
offset, the aurora moves `18px·mx, 14px·my + .3·sy`, the grid `−10px·mx, −8px·my + .18·sy` and the coins
`−10px·mx, −8px·my − .08·sy`. The aurora and coins ease over 900 and 700ms; the grid tracks directly so the
spotlight's grid stays aligned with it.

**Payment stream:** when a payment lands, 22 sats (12 on phones; teal, with every fourth one gold) fly from the hero
button to the receipt total. They follow a shallow arc that sags below the line between the two, so it never crosses
the headline. Each takes 520–700ms with three trailing ghosts and an 8ms stagger. The total's burst and nudge wait
520ms so they fire on arrival. This is one fixed canvas whose loop runs only while sats are in flight.

**Phones:** four blobs, a 36px grid with a wider mask, no coins, no spotlight and no pointer parallax (scroll parallax
stays).

**Deck and video:** to reuse the look as a still, use paper + grain + the five blobs at the positions above + the grid.
For motion, loop the blob drift and the coin drift; the spotlight and stream are interaction-only.

## The receipt-ticket motif

The receipt is the product's hero object: a paper slip in mono type that fills in live.

- **Shape:** a white slip with a 10px radius and a 1px `line` border, lifted by the receipt shadow.
- **Paper:** a 180px fibre texture over the panel colour: horizontally stretched noise (baseFrequency `.75 .22`, 3 octaves). In light it is dark specks at alpha `.2·noise − .075`; in dark it is pale specks at `.12·noise − .045`. Receipt text stays above 5.5:1.
- **Punched notches** are filled with the page colour tinted 16% toward the accent (12% in dark), so they match the aurora behind the slip.
- **Perforations:** three tear lines, each a 2px dashed `line-2` rule inset 14px. Each tear line has a punched half-circle notch (16px) at both ends, filled with the page colour.
- **Rows:** in order, header (`AGENTTAB` · `TAB #ABCD`), status, `locked in tab`, up to three `/api/oracle 402 → 200  +1,000` rows, `on-chain txs for these calls  0`, then **Total** with a spend bar (accent for provider, `fg/25` for change back), and the open/settle txids.
- **Motion:**
  - The 5¢ coin flies in when the tab opens (400ms), then bursts into eight specks.
  - Each paid call slides in (300ms) and bursts eight teal/gold specks off the total, which counts up and nudges 1px.
  - The `0` on-chain counter pulses.
  - `SETTLED` stamps in at −6°.
- **Burst:** eight 4–5px dots, accent / gold / pale accent, flying 18–38px out over 700ms and fading. The burst is hidden under reduced motion.

## Motion rules

- **Durations:** 150–400ms with ease-out (`cubic-bezier(.2,.7,.3,1)`). The exceptions are the 700ms burst, the 520–700ms payment stream and the ambient background (aurora and coins on 23–89s loops).
- **Performance:** the background uses transforms, opacity and two small canvases only. It runs at 60 fps on a GPU, the same as with the background off. Under software rendering (no GPU, 2x DPR) it runs at about 50 fps idle.
- **Micro-interactions:** buttons press to 98%. Header controls darken their border and fill on hover. Inactive tabs get a `subtle` fill on hover, and the tab indicator slides in 250ms.
- **Reduced motion:** `prefers-reduced-motion: reduce` disables every animation and transition and hides the burst. The aurora and coins are drawn once and stay still. The spotlight, the parallax and the payment stream are off.
- **Header:** the BLAZE banner and the nav form one sticky glass header, so the banner is never half-clipped.
- **Theme:** the header button is a two-state light/dark switch that always flips what is on screen. It is not a light/dark/auto cycle, because auto looked like a no-op on a light OS. Dark tokens are unlayered CSS so they override the unlayered light `:root` tokens.
