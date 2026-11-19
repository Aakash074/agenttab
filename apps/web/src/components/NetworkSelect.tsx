import { useEffect, useId, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Net } from '../config';
import { keyToAction, listboxReducer, type ListboxAction, type ListboxState } from '../lib/listbox';

const NETS: { id: Net; name: string; desc: string }[] = [
  { id: 'mainnet', name: 'Mainnet', desc: 'Real BCH · pay 1¢ for a live answer' },
  { id: 'chipnet', name: 'Chipnet', desc: 'Free test coins · 5¢ demo · 7 attacks' },
];

const Dot = ({ net }: { net: Net }) => <span aria-hidden className={`net-dot ${net === 'mainnet' ? 'is-main' : 'is-chip'}`} />;
const Check = () => (
  <svg aria-hidden viewBox="0 0 16 16" className="h-4 w-4 shrink-0 text-bch-2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3.5 8.5 3 3 6-7" /></svg>
);

/**
 * Network switch: a button + listbox popover (glass), replacing the native <select>.
 * Keyboard: Enter / Space / arrows open; arrows, Home and End move; Enter / Space pick; Escape closes; focus returns to
 * the trigger. aria-activedescendant tracks the active option. On phones the list opens as a bottom sheet.
 * `onChange` is the same setNet the <select> called, so deep links, saved picks and URL updates are unchanged.
 */
export function NetworkSelect({ net, onChange, mainnetEnabled }: { net: Net; onChange: (n: Net) => void; mainnetEnabled: boolean }) {
  const options = NETS.map((o) => ({ ...o, disabled: o.id === 'mainnet' && !mainnetEnabled }));
  const selected = Math.max(0, options.findIndex((o) => o.id === net));
  const [s, dispatch] = useReducer((st: ListboxState, a: ListboxAction) => listboxReducer(options, st, a), { open: false, active: selected });
  const [mounted, setMounted] = useState(false); // keeps the panel in the DOM for the close animation
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  // The panel is portalled to <body>: inside the glass header its own backdrop blur could only see the header (the
  // header is the backdrop root), and on phones the header would become the containing block for the fixed sheet.
  // Desktop: fixed just under the trigger (the header is sticky, so the trigger does not move). Phones: bottom sheet.
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const [phone, setPhone] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(max-width: 639px)').matches);
  useEffect(() => { const m = matchMedia('(max-width: 639px)'); const f = () => setPhone(m.matches); m.addEventListener('change', f); return () => m.removeEventListener('change', f); }, []);
  const id = useId();

  useEffect(() => {
    if (s.open) {
      const r = trigger.current?.getBoundingClientRect();
      if (r) setPos({ top: Math.round(r.bottom + 8), right: Math.round(document.documentElement.clientWidth - r.right) });
      setMounted(true); return;
    }
    const t = setTimeout(() => setMounted(false), 160);
    return () => clearTimeout(t);
  }, [s.open]);
  // Move focus into the listbox once it is in the DOM (aria-activedescendant then tracks the active option).
  useLayoutEffect(() => { if (s.open && mounted) list.current?.focus({ preventScroll: true }); }, [s.open, mounted]);
  useEffect(() => {
    if (!s.open) return;
    const away = (e: PointerEvent) => { const t = e.target as Node; if (!wrap.current?.contains(t) && !panel.current?.contains(t)) dispatch({ type: 'close' }); };
    const shut = () => dispatch({ type: 'close' });
    document.addEventListener('pointerdown', away);
    window.addEventListener('resize', shut);
    return () => { document.removeEventListener('pointerdown', away); window.removeEventListener('resize', shut); };
  }, [s.open]);

  const pick = (i: number) => {
    const o = options[i];
    dispatch({ type: 'close' });
    trigger.current?.focus();
    if (o && !o.disabled && o.id !== net) onChange(o.id);
  };
  const onKey = (e: React.KeyboardEvent) => {
    const r = keyToAction(e.key, s.open, selected);
    if (!r) return;
    if (e.key !== 'Tab') e.preventDefault();
    if (r.pick) { pick(s.active); return; }
    if (r.action) dispatch(r.action);
    if (r.refocus) trigger.current?.focus();
  };
  const cur = options[selected];

  return (
    <div ref={wrap} className="relative shrink-0">
      <button ref={trigger} type="button" className="control net-trigger gap-2 pl-3 pr-2.5" aria-haspopup="listbox" aria-expanded={s.open}
        aria-controls={`${id}-list`} aria-label={`Network: ${cur.name}`} onClick={() => dispatch({ type: 'toggle', selected })} onKeyDown={onKey}
        title="Network (Chipnet = testnet, free test coins)">
        <Dot net={cur.id} /><span>{cur.name}</span>
        <svg aria-hidden viewBox="0 0 12 12" fill="none" className={`net-chevron h-3 w-3 text-dim ${s.open ? 'is-open' : ''}`}><path d="M2.75 4.5 6 7.75 9.25 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {mounted && createPortal(<>
          {phone && <div aria-hidden className={`net-scrim ${s.open ? 'is-open' : ''}`} onPointerDown={() => dispatch({ type: 'close' })} />}
          <div ref={panel} className={`net-panel ${phone ? 'is-sheet' : ''} ${s.open ? 'is-open' : ''}`}
            style={!phone && pos ? { top: pos.top, right: pos.right } : undefined}>
            <p className="px-3 pb-1.5 pt-1 text-[11.5px] font-medium uppercase tracking-[0.12em] text-dim">Network</p>
            <ul ref={list} id={`${id}-list`} role="listbox" tabIndex={-1} aria-label="Network" aria-activedescendant={s.open ? `${id}-opt-${s.active}` : undefined}
              onKeyDown={onKey} className="outline-none">
              {options.map((o, i) => (
                <li key={o.id} id={`${id}-opt-${i}`} role="option" aria-selected={i === selected} aria-disabled={o.disabled || undefined}
                  className={`net-option ${i === s.active ? 'is-active' : ''} ${o.disabled ? 'is-disabled' : ''}`}
                  onPointerMove={() => dispatch({ type: 'hover', index: i })} onClick={() => !o.disabled && pick(i)}>
                  <Dot net={o.id} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-semibold text-fg">{o.name}{o.disabled ? ' (soon)' : ''}</span>
                    <span className="block text-[12.5px] leading-snug text-muted">{o.desc}</span>
                  </span>
                  {i === selected ? <Check /> : <span className="h-4 w-4 shrink-0" />}
                </li>
              ))}
            </ul>
          </div>
        </>, document.body)}
    </div>
  );
}
