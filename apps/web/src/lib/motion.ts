import { useEffect, useRef, useState } from 'react';

export const reducedMotion = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Tween a number towards `target` (ease-out, rAF). Snaps instantly under prefers-reduced-motion. */
export function useCountUp(target: number, ms = 400, from?: number) {
  const [v, setV] = useState(from ?? target);
  const cur = useRef(from ?? target);
  useEffect(() => {
    const a = cur.current, d = target - a;
    if (!d) return;
    if (reducedMotion()) { cur.current = target; setV(target); return; }
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      const n = Math.round(a + d * (1 - (1 - p) ** 3));
      cur.current = n; setV(n);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    // rAF pauses in background tabs: make sure the final value always lands.
    const snap = setTimeout(() => { cancelAnimationFrame(raf); cur.current = target; setV(target); }, ms + 120);
    return () => { cancelAnimationFrame(raf); clearTimeout(snap); };
  }, [target, ms]);
  return v;
}

/** Smooth scroll unless the visitor asked for less motion. */
export function scrollToId(id: string, block: ScrollLogicalPosition = 'start') {
  document.getElementById(id)?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block });
}
