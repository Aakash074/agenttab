import { useEffect, useRef } from 'react';
import { reducedMotion } from '../lib/motion';

/** Fired when a payment lands on the receipt; the stream canvas flies sats from the CTA into the total. */
export const LANDED = 'agenttab:landed';
export const emitLanded = () => window.dispatchEvent(new CustomEvent(LANDED));

// Drifting sats coins: [left %, top %, size px, drift seconds, delay seconds]. The last three are desktop only.
const COINS: [number, number, number, number, number][] = [
  [4, 12, 18, 26, -4], [93, 18, 22, 31, -12], [52, 6, 12, 23, -7], [96, 62, 14, 28, -18], [47, 78, 16, 34, -9], [30, 90, 11, 25, -15],
];

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
      inside = cx >= 0 && y >= 0 && y <= Math.min(r.height, 900);
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
        {COINS.map(([l, t, s, d, delay], i) => (
          <span key={i} className={`coin-float${i > 2 ? ' coin-desk' : ''}`} data-drift={d} data-delay={delay}
            style={{ left: `${l}%`, top: `${t}%`, width: s, height: s }} />
        ))}
      </div>
    </div>
  );
}

// Aurora blobs: colour token, centre (x, y as a fraction of the canvas), radius as a fraction of the width
// (desktop, phone), aspect, drift amplitude (fraction of radius) and periods in seconds. Phones skip blob 4.
type Blob = { c: string; x: number; y: number; r: number; mx: number; my: number; mr: number; asp: number; amp: number; tx: number; ty: number; ts: number; phone?: boolean };
const BLOBS: Blob[] = [
  { c: '--bg-aurora-1', x: 0.76, y: 0.22, r: 0.27, mx: 0.98, my: 0.3, mr: 0.55, asp: 0.87, amp: 0.34, tx: 61, ty: 47, ts: 53 },
  { c: '--bg-aurora-2', x: 0.86, y: 0.56, r: 0.2, mx: 0.3, my: 0.78, mr: 0.6, asp: 1, amp: 0.4, tx: 73, ty: 59, ts: 67 },
  { c: '--bg-aurora-3', x: 0.12, y: 0.08, r: 0.24, mx: 0.05, my: 0.12, mr: 0.6, asp: 0.77, amp: 0.3, tx: 89, ty: 71, ts: 79 },
  { c: '--bg-aurora-4', x: 0.24, y: 0.62, r: 0.21, mx: 0, my: 0, mr: 0, asp: 0.7, amp: 0.35, tx: 52, ty: 43, ts: 61, phone: false },
];
// Any CSS colour (the build minifies tokens to #rrggbbaa) -> [r, g, b, a], normalised by the canvas itself.
const rgba = (ctx: CanvasRenderingContext2D, v: string) => {
  ctx.fillStyle = '#0000'; ctx.fillStyle = v.trim() || '#0000';
  const c = String(ctx.fillStyle);
  if (c.startsWith('#')) return [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)).concat(1);
  const n = (c.match(/[\d.]+/g) ?? []).map(Number);
  return [n[0] ?? 0, n[1] ?? 0, n[2] ?? 0, n[3] ?? 1];
};

/**
 * The aurora mesh: four soft radial blobs drawn at 1/8 resolution and upscaled by CSS (the blobs are pure blur, so
 * nothing is lost), redrawn at 30 Hz, and the drifting coins moved on the same tick (transform only). One small
 * canvas composites far cheaper than four large animated layers, and one tick means one background frame per 33 ms.
 * Stops when the tab is hidden or the hero is off screen; drawn once, static, under prefers-reduced-motion.
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
      BLOBS.forEach((b, i) => {
        if (phone && b.phone === false) return;
        const [r, g, bl, a] = cols[i] ?? [0, 0, 0, 0];
        const rad = (phone ? b.mr : b.r) * W;
        const k = 2 * Math.PI;
        const cx = (phone ? b.mx : b.x) * W + Math.sin((k * s) / b.tx + i) * b.amp * rad;
        const cy = (phone ? b.my : b.y) * H + Math.sin((k * s) / b.ty + i * 2) * b.amp * rad * 0.8;
        const sc = 1 + Math.sin((k * s) / b.ts + i) * 0.1;
        ctx.setTransform(sc, 0, 0, sc * b.asp, cx, cy);
        const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, rad);
        gr.addColorStop(0, `rgb(${r} ${g} ${bl} / ${a})`);
        gr.addColorStop(0.55, `rgb(${r} ${g} ${bl} / ${a * 0.45})`);
        gr.addColorStop(1, `rgb(${r} ${g} ${bl} / 0)`);
        ctx.fillStyle = gr;
        ctx.fillRect(-rad, -rad, rad * 2, rad * 2);
      });
      // fade out towards the bottom of the hero
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'destination-in';
      const f = ctx.createLinearGradient(0, 0, 0, H);
      f.addColorStop(0.55, '#000'); f.addColorStop(0.96, 'rgb(0 0 0 / 0)');
      ctx.fillStyle = f; ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over';
      // the coins drift on the same tick, so the whole background renders one frame per tick
      coins.forEach((c) => {
        const u = (1 - Math.cos((Math.PI * (s + c.delay)) / c.d)) / 2; // eased ping-pong over d seconds
        c.el.style.transform = `translate3d(${(16 * Math.sin(Math.PI * u) - 12 * u * u).toFixed(1)}px, ${(-56 * u).toFixed(1)}px, 0) rotate(${(300 * u).toFixed(0)}deg)`;
      });
    };
    const still = reducedMotion();
    if (still) coins.length = 0;
    const tick = (t: number) => {
      raf = 0;
      if (t - last >= 33) { last = t; draw(t); }
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
