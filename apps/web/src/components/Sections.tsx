import { useLayoutEffect, useRef, useState } from 'react';

export type SectionId = 'feed' | 'cheat' | 'how' | 'agent';
export const SECTIONS: { id: SectionId; label: string; short: string }[] = [
  { id: 'feed', label: 'Live feed', short: 'Feed' },
  { id: 'cheat', label: 'Try to cheat it', short: 'Cheat it' },
  { id: 'how', label: 'How it works', short: 'How' },
  { id: 'agent', label: 'Use with your agent', short: 'Your agent' },
];

/** One segmented control; panels crossfade. Panels stay mounted (hidden) so their state survives switching; the attack panel mounts on first visit. */
export function Sections({ active, onChange, panels }: {
  active: SectionId; onChange: (id: SectionId) => void; panels: Partial<Record<SectionId, React.ReactNode>>;
}) {
  const btns = useRef<Partial<Record<SectionId, HTMLButtonElement | null>>>({});
  const [ind, setInd] = useState<{ x: number; w: number } | null>(null);
  const [visited, setVisited] = useState<Set<SectionId>>(() => new Set<SectionId>(['feed', 'how', 'agent', active]));
  if (!visited.has(active)) setVisited(new Set([...visited, active]));
  useLayoutEffect(() => {
    const place = () => { const b = btns.current[active]; if (b) setInd({ x: b.offsetLeft, w: b.offsetWidth }); };
    place();
    const b = btns.current[active];
    if (!b || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(place);
    ro.observe(b); if (b.parentElement) ro.observe(b.parentElement);
    return () => ro.disconnect();
  }, [active]);
  const key = (e: React.KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    const n = SECTIONS[(i + d + SECTIONS.length) % SECTIONS.length].id;
    onChange(n); btns.current[n]?.focus();
  };
  return (
    <div id="sections" className="scroll-mt-20">
      <div role="tablist" aria-label="More about AgentTab" className="relative flex w-full rounded-xl border border-line bg-panel-2 p-1 sm:w-fit">
        {ind && <span aria-hidden className="tab-indicator absolute bottom-1 top-1 left-0 rounded-lg bg-panel shadow-[0_1px_2px_rgb(17_26_23/0.12)] ring-1 ring-line"
          style={{ transform: `translateX(${ind.x}px)`, width: ind.w }} />}
        {SECTIONS.map((s, i) => (
          <button key={s.id} ref={(el) => { btns.current[s.id] = el; }} role="tab" id={`tab-${s.id}`} aria-selected={active === s.id} aria-controls={`panel-${s.id}`}
            tabIndex={active === s.id ? 0 : -1} onClick={() => onChange(s.id)} onKeyDown={(e) => key(e, i)}
            className={`relative z-10 min-h-[44px] flex-1 whitespace-nowrap rounded-lg px-2 text-sm font-medium transition-colors sm:flex-none sm:px-4 ${active === s.id ? 'text-fg' : 'text-muted hover:text-fg'}`}>
            <span className="sm:hidden">{s.short}</span><span className="hidden sm:inline">{s.label}</span>
          </button>
        ))}
      </div>
      {SECTIONS.map((s) => visited.has(s.id) && (
        <div key={s.id} role="tabpanel" id={`panel-${s.id}`} aria-labelledby={`tab-${s.id}`} hidden={active !== s.id} className="fade-in mt-5">
          {panels[s.id]}
        </div>
      ))}
    </div>
  );
}
