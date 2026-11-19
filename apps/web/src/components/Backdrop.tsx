import { useEffect, useRef } from 'react';
import { reducedMotion } from '../lib/motion';

/** Fired when a payment lands on the receipt; the stream canvas flies sats from the CTA into the total. */
export const LANDED = 'agenttab:landed';
export const emitLanded = () => window.dispatchEvent(new CustomEvent(LANDED));

// Drifting BCH coins: [side, inset from that side in px, top px, size px, drift seconds, delay seconds, desktop only].
// They live only in the page margins (never under text or the receipt; two drift under the glass header) and are hidden when the margin is
// too narrow to hold them (see .coin-float in index.css).
const COINS: ['l' | 'r', number, number, number, number, number, boolean][] = [
  ['l', 96, 22, 24, 29, -6, true], ['r', 112, 56, 20, 33, -14, true], // these two sit under the glass header
  ['l', 34, 214, 30, 26, -4, true], ['l', 70, 560, 22, 31, -12, true], ['r', 40, 168, 28, 23, -7, false],
  ['r', 76, 470, 20, 28, -18, true], ['r', 30, 700, 24, 34, -9, true],
];

/** A coin face: teal disc, milled rim and a tilted ₿ (the Bitcoin Cash mark), drawn as SVG so it never depends on fonts. */
const CoinFace = () => (
  <svg viewBox="0 0 32 32" aria-hidden>
    <circle cx="16" cy="16" r="15" className="coin-disc" />
    <circle cx="16" cy="16" r="12.2" className="coin-rim" />
    <g transform="rotate(-14 16 16)" className="coin-glyph">
      <path d="M12.2 10.2h4.6a2.7 2.7 0 0 1 0 5.4h-4.6m0 0h5.2a2.8 2.8 0 0 1 0 5.6h-5.2zm0-11v11M14.4 8.1v2.1m2.6-2.1v2.1m-2.6 11v2.1m2.6-2.1v2.1" />
    </g>
  </svg>
);

/**
 * The hero background: aurora mesh (one low-res canvas), a line-and-dot grid with a radial fade, a cursor spotlight and a few drifting
 * coins. Apart from the aurora canvas, everything animates with transform/opacity only. Pointer and scroll positions are written once per frame
 * as CSS variables; the layers turn them into parallax. Paused when the tab is hidden or the hero is off screen,
 * and static under prefers-reduced-motion.
 */
export function Backdrop() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let onScreen = true;
    const sync = () => el.classList.toggle('is-paused', document.hidden || !onScreen);
    const io = new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; sync(); });
    io.observe(el);
    document.addEventListener('visibilitychange', sync);
    if (reducedMotion()) return () => { io.disconnect(); document.removeEventListener('visibilitychange', sync); };

    const fine = matchMedia('(pointer: fine) and (min-width: 768px)').matches;
    let raf = 0, px = 0, py = 0, cx = -1, cy = -1, inside = false;
    // Grid parallax (gx, gy) and the spotlight. The spotlight is a masked 520px window translated to the cursor,
    // holding a brighter copy of the grid shifted back by (cursor mod 44px) so its lines sit exactly on the base grid.
    const G = 44, S = 520, mod = (a: number) => ((a % G) + G) % G;
    const write = () => {
      raf = 0;
      const r = el.getBoundingClientRect();
      const sy = -r.top;
      const gx = fine ? px * -10 : 0, gy = (fine ? py * -8 : 0) + sy * 0.18;
      const st = el.style;
      st.setProperty('--sy', `${Math.round(sy)}`);
      st.setProperty('--gx', `${gx.toFixed(1)}px`);
      st.setProperty('--gy', `${gy.toFixed(1)}px`);
      if (!fine) return;
      st.setProperty('--mx', px.toFixed(3));
      st.setProperty('--my', py.toFixed(3));
      const x = cx - r.left, y = cy - r.top;
      inside = cx >= 0 && y >= 0 && y <= r.height;
      el.classList.toggle('spot-on', inside);
      if (!inside) return;
      const L = x - S / 2, T = y - S / 2;
      st.setProperty('--cx', `${Math.round(L)}px`);
      st.setProperty('--cy', `${Math.round(T)}px`);
      // the base grid layer starts at -60px (its inset) plus the parallax offset
      st.setProperty('--ox', `${(-mod(L + 60 - gx)).toFixed(1)}px`);
      st.setProperty('--oy', `${(-mod(T + 60 - gy)).toFixed(1)}px`);
    };
    const queue = () => { if (!raf) raf = requestAnimationFrame(write); };
    const move = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      cx = e.clientX; cy = e.clientY;
      px = (e.clientX / innerWidth) * 2 - 1; py = (e.clientY / innerHeight) * 2 - 1;
      queue();
    };
    const leave = () => { el.classList.remove('spot-on'); };
    if (fine) { addEventListener('pointermove', move, { passive: true }); document.documentElement.addEventListener('pointerleave', leave); }
    addEventListener('scroll', queue, { passive: true });
    queue();
    return () => {
      io.disconnect(); document.removeEventListener('visibilitychange', sync);
      removeEventListener('pointermove', move); document.documentElement.removeEventListener('pointerleave', leave);
      removeEventListener('scroll', queue); cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div ref={ref} aria-hidden className="backdrop">
      <div className="bg-layer bg-aurora-wrap"><Aurora /></div>
      <div className="bg-layer bg-grid" />
      <div className="bg-spot"><div className="bg-spot-grid" /></div>
      <div className="bg-layer bg-coins">
        {COINS.map(([side, inset, top, size, d, delay, desk], i) => (
          <span key={i} className={`coin-float${desk ? ' coin-desk' : ''}`} data-drift={d} data-delay={delay}
            style={{ [side === 'l' ? 'left' : 'right']: inset, top, width: size, height: size }}><CoinFace /></span>
        ))}
      </div>
    </div>
  );
}

// Aurora blobs on ONE full-page canvas (top pixel to bottom pixel, behind the glass header and footer).
// x and r are fractions of the width; y is page px for the hero blobs (yPx) or a fraction of the page height for the
// blobs that carry the light down the page (yF). m* are the phone values. k scales the token's alpha.
type Blob = { c: string; x: number; r: number; mx: number; mr: number; asp: number; amp: number; tx: number; ty: number; ts: number;
  yPx?: number; myPx?: number; yF?: number; k?: number; phone?: boolean };
const BLOBS: Blob[] = [
  { c: '--bg-aurora-1', x: 0.76, yPx: 260, r: 0.27, mx: 0.98, myPx: 360, mr: 0.55, asp: 0.87, amp: 0.34, tx: 61, ty: 47, ts: 53 },
  { c: '--bg-aurora-2', x: 0.86, yPx: 665, r: 0.2, mx: 0.3, myPx: 930, mr: 0.6, asp: 1, amp: 0.4, tx: 73, ty: 59, ts: 67 },
  { c: '--bg-aurora-3', x: 0.12, yPx: 60, r: 0.24, mx: 0.05, myPx: 100, mr: 0.6, asp: 0.77, amp: 0.3, tx: 89, ty: 71, ts: 79 },
  { c: '--bg-aurora-4', x: 0.24, yPx: 736, r: 0.21, mx: 0, mr: 0, asp: 0.7, amp: 0.35, tx: 52, ty: 43, ts: 61, phone: false },
  // left counterweight to the receipt glow, mostly in the left margin so the copy keeps its contrast
  { c: '--bg-aurora-5', x: 0.02, yPx: 500, r: 0.17, mx: -0.1, myPx: 540, mr: 0.4, asp: 1.5, amp: 0.25, tx: 67, ty: 53, ts: 71 },
  // a soft teal light right under the glass header, so the glass reads as glass
  { c: '--bg-aurora-2', x: 0.5, yPx: -10, r: 0.2, mx: 0.6, myPx: -10, mr: 0.5, asp: 0.45, amp: 0.45, tx: 47, ty: 37, ts: 41, k: 0.75 },
  // down the page: left behind the tabs, right behind the cards, and a wide glow under the footer
  { c: '--bg-aurora-2', x: 0.03, yF: 0.55, r: 0.2, mx: 0.0, mr: 0.55, asp: 1.3, amp: 0.3, tx: 83, ty: 61, ts: 73, k: 0.6 },
  { c: '--bg-aurora-1', x: 0.97, yF: 0.74, r: 0.22, mx: 1.0, mr: 0.55, asp: 1.2, amp: 0.3, tx: 77, ty: 57, ts: 69, k: 0.6 },
  { c: '--bg-aurora-2', x: 0.5, yF: 1.0, r: 0.34, mx: 0.5, mr: 0.8, asp: 0.55, amp: 0.25, tx: 91, ty: 67, ts: 83, k: 0.7 },
];
const AURORA_TOP = 80; // the canvas starts 80px above the page top (see .bg-aurora-wrap)
// Any CSS colour (the build minifies tokens to #rrggbbaa) -> [r, g, b, a], normalised by the canvas itself.
const rgba = (ctx: CanvasRenderingContext2D, v: string) => {
  ctx.fillStyle = '#0000'; ctx.fillStyle = v.trim() || '#0000';
  const c = String(ctx.fillStyle);
  if (c.startsWith('#')) return [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)).concat(1);
  const n = (c.match(/[\d.]+/g) ?? []).map(Number);
  return [n[0] ?? 0, n[1] ?? 0, n[2] ?? 0, n[3] ?? 1];
};

/**
 * The aurora mesh: soft radial blobs over the whole page, drawn at 1/8 resolution and upscaled by CSS (the blobs are pure blur, so
 * nothing is lost), redrawn at 20 Hz, and the drifting coins moved on the same tick (transform only). One small
 * canvas composites far cheaper than four large animated layers, and one tick means one background frame per 50 ms.
 * Stops when the tab is hidden; drawn once, static, under prefers-reduced-motion.
 */
function Aurora() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext('2d');
    if (!cv || !ctx) return;
    const K = 8;
    let W = 0, H = 0, phone = false, raf = 0, last = 0, onScreen = true;
    let cols: number[][] = [];
    const coins = [...(cv.closest('.backdrop')?.querySelectorAll<HTMLElement>('.coin-float') ?? [])]
      .map((el) => ({ el, d: Number(el.dataset.drift) || 28, delay: -(Number(el.dataset.delay) || 0) }));
    const readColours = () => { const cs = getComputedStyle(cv); cols = BLOBS.map((b) => rgba(ctx, cs.getPropertyValue(b.c))); };
    const size = () => {
      const r = cv.getBoundingClientRect();
      W = Math.max(1, Math.ceil(r.width / K)); H = Math.max(1, Math.ceil(r.height / K));
      cv.width = W; cv.height = H; phone = innerWidth < 768;
    };
    const draw = (t: number) => {
      const s = t / 1000;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const pageH = H * K - 2 * AURORA_TOP;
      BLOBS.forEach((b, i) => {
        if (phone && b.phone === false) return;
        const [r, g, bl, a0] = cols[i] ?? [0, 0, 0, 0];
        const a = a0 * (b.k ?? 1) * (phone ? 0.65 : 1); // phones: text sits over the blobs, so softer light
        const rad = (phone ? b.mr : b.r) * W;
        const k = 2 * Math.PI;
        const yPage = b.yF !== undefined ? b.yF * pageH : (phone ? b.myPx ?? b.yPx ?? 0 : b.yPx ?? 0);
        const cx = (phone ? b.mx : b.x) * W + Math.sin((k * s) / b.tx + i) * b.amp * rad;
        const cy = (yPage + AURORA_TOP) / K + Math.sin((k * s) / b.ty + i * 2) * b.amp * rad * 0.8;
        const sc = 1 + Math.sin((k * s) / b.ts + i) * 0.1;
        ctx.setTransform(sc, 0, 0, sc * b.asp, cx, cy);
        const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, rad);
        gr.addColorStop(0, `rgb(${r} ${g} ${bl} / ${a})`);
        gr.addColorStop(0.55, `rgb(${r} ${g} ${bl} / ${a * 0.45})`);
        gr.addColorStop(1, `rgb(${r} ${g} ${bl} / 0)`);
        ctx.fillStyle = gr;
        ctx.fillRect(-rad, -rad, rad * 2, rad * 2);
      });
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      // the coins drift on the same tick, so the whole background renders one frame per tick
      coins.forEach((c) => {
        const u = (1 - Math.cos((Math.PI * (s + c.delay)) / c.d)) / 2; // eased ping-pong over d seconds
        c.el.style.transform = `translate3d(${(6 * Math.sin(Math.PI * 2 * u)).toFixed(1)}px, ${(-22 * u).toFixed(1)}px, 0) rotate(${(-10 + 20 * u).toFixed(1)}deg)`;
      });
    };
    const still = reducedMotion();
    if (still) coins.length = 0;
    const tick = (t: number) => {
      raf = 0;
      if (t - last >= 50) { last = t; draw(t); }
      if (!still && onScreen && !document.hidden) raf = requestAnimationFrame(tick);
    };
    const kick = () => { if (!raf) raf = requestAnimationFrame(tick); };
    const io = new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; if (onScreen) kick(); });
    const ro = new ResizeObserver(() => { size(); last = 0; kick(); });
    const theme = new MutationObserver(() => { readColours(); last = 0; kick(); });
    const os = matchMedia('(prefers-color-scheme: dark)');
    const vis = () => { if (!document.hidden) kick(); };
    const osChange = () => { readColours(); last = 0; kick(); };
    readColours(); size();
    io.observe(cv); ro.observe(cv);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    os.addEventListener('change', osChange);
    document.addEventListener('visibilitychange', vis);
    kick();
    return () => { cancelAnimationFrame(raf); io.disconnect(); ro.disconnect(); theme.disconnect(); os.removeEventListener('change', osChange); document.removeEventListener('visibilitychange', vis); };
  }, []);
  return <canvas ref={ref} className="aurora-canvas" />;
}

type P = { t0: number; dur: number; r: number; c: string; wob: number };

/**
 * A one-shot stream of sats from the hero CTA into the receipt total. One fixed canvas over the page
 * (pointer-events none, rendered outside .backdrop so it sits above the content); its rAF loop only runs while particles are in flight. Skipped under reduced motion.
 */
export function PaymentStream() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    let raf = 0;
    let parts: P[] = [];
    let from = { x: 0, y: 0 }, to = { x: 0, y: 0 };
    const stop = () => { cancelAnimationFrame(raf); raf = 0; parts = []; cv.getContext('2d')?.clearRect(0, 0, cv.width, cv.height); cv.style.opacity = '0'; };
    const fire = () => {
      if (reducedMotion() || document.hidden) return;
      const src = document.querySelector<HTMLElement>('[data-stream-src]') ?? document.querySelector<HTMLElement>('h1');
      const dst = document.querySelector<HTMLElement>('[data-stream-dst]') ?? document.getElementById('ticket');
      if (!src || !dst) return;
      const a = src.getBoundingClientRect(), b = dst.getBoundingClientRect();
      const visible = (r: DOMRect) => r.bottom > 0 && r.top < innerHeight;
      if (!visible(a) || !visible(b)) return;
      const dpr = Math.min(2, devicePixelRatio || 1);
      cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
      cv.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0);
      const side = b.left > a.right - 40; // receipt to the right of the CTA (desktop) or below it (phone)
      from = side ? { x: a.right - 18, y: a.top + a.height / 2 } : { x: a.left + a.width / 2, y: a.bottom - 6 };
      to = { x: b.left + b.width / 2, y: b.top + b.height / 2 };
      const css = getComputedStyle(document.documentElement);
      const teal = css.getPropertyValue('--color-bch').trim() || '#0e6b60';
      const gold = css.getPropertyValue('--color-gold').trim() || '#7a5200';
      const now = performance.now();
      const n = innerWidth < 768 ? 12 : 22;
      parts = Array.from({ length: n }, (_, i) => ({ t0: now + i * 16 + Math.random() * 40, dur: 520 + Math.random() * 180, r: 1.6 + Math.random() * 2, c: i % 4 === 3 ? gold : teal, wob: (Math.random() - 0.5) * 70 }));
      cv.style.opacity = '1';
      if (!raf) raf = requestAnimationFrame(tick);
    };
    const tick = (t: number) => {
      const ctx = cv.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      // a shallow arc that sags below the CTA-to-receipt line, so it never crosses the headline
      const mx = (from.x + to.x) / 2, my = Math.max(from.y, to.y) + Math.max(36, Math.abs(to.x - from.x) * 0.12);
      let live = 0;
      for (const p of parts) {
        const k = (t - p.t0) / p.dur;
        if (k < 0) { live++; continue; }
        if (k >= 1) continue;
        live++;
        // a few trailing ghosts per particle, along a quadratic arc with a per-particle wobble on the control point
        for (let g = 0; g < 4; g++) {
          const u = Math.max(0, k - g * 0.035);
          const e = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
          const qx = mx + p.wob, qy = my + p.wob * 0.4;
          const x = (1 - e) ** 2 * from.x + 2 * (1 - e) * e * qx + e * e * to.x;
          const y = (1 - e) ** 2 * from.y + 2 * (1 - e) * e * qy + e * e * to.y;
          ctx.globalAlpha = (1 - g / 4) * Math.min(1, k * 6) * (k > 0.85 ? (1 - k) / 0.15 : 1) * 0.9;
          ctx.fillStyle = p.c;
          ctx.beginPath(); ctx.arc(x, y, p.r * (1 - g * 0.18), 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      if (live && !document.hidden) raf = requestAnimationFrame(tick); else stop();
    };
    const hide = () => { if (document.hidden) stop(); };
    addEventListener(LANDED, fire);
    document.addEventListener('visibilitychange', hide);
    return () => { removeEventListener(LANDED, fire); document.removeEventListener('visibilitychange', hide); stop(); };
  }, []);
  return <canvas ref={ref} className="stream-canvas" />;
}
