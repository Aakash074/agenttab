/** Keyboard + open/close state for a single-select listbox popover (pure, so it is unit-tested without a DOM). */

export interface ListboxState { open: boolean; active: number }
export interface ListboxOption { disabled?: boolean }

export type ListboxAction =
  | { type: 'open'; selected: number }
  | { type: 'close' }
  | { type: 'toggle'; selected: number }
  | { type: 'move'; delta: 1 | -1 }
  | { type: 'first' }
  | { type: 'last' }
  | { type: 'hover'; index: number };

/** Next enabled index from `from` in direction `delta`, wrapping; `from` itself if nothing else is enabled. */
export function step(options: ListboxOption[], from: number, delta: 1 | -1): number {
  const n = options.length;
  for (let i = 1; i <= n; i++) {
    const k = (((from + delta * i) % n) + n) % n;
    if (!options[k]?.disabled) return k;
  }
  return from;
}

const firstEnabled = (options: ListboxOption[]) => Math.max(0, options.findIndex((o) => !o.disabled));
const lastEnabled = (options: ListboxOption[]) => {
  for (let i = options.length - 1; i >= 0; i--) if (!options[i].disabled) return i;
  return 0;
};

export function listboxReducer(options: ListboxOption[], s: ListboxState, a: ListboxAction): ListboxState {
  switch (a.type) {
    case 'open': return { open: true, active: options[a.selected]?.disabled ? firstEnabled(options) : a.selected };
    case 'close': return s.open ? { ...s, open: false } : s;
    case 'toggle': return s.open ? { ...s, open: false } : listboxReducer(options, s, { type: 'open', selected: a.selected });
    case 'move': return s.open ? { ...s, active: step(options, s.active, a.delta) } : s;
    case 'first': return s.open ? { ...s, active: firstEnabled(options) } : s;
    case 'last': return s.open ? { ...s, active: lastEnabled(options) } : s;
    case 'hover': return s.open && !options[a.index]?.disabled ? { ...s, active: a.index } : s;
  }
}

/** What a key does. On the closed trigger: Enter/Space/ArrowDown/ArrowUp open. In the open list: arrows, Home/End
 *  move; Enter/Space pick the active option; Escape and Tab close. Returns null for keys the listbox ignores. */
export type KeyResult = { action?: ListboxAction; pick?: boolean; refocus?: boolean } | null;
export function keyToAction(key: string, open: boolean, selected: number): KeyResult {
  if (!open) {
    if (key === 'Enter' || key === ' ' || key === 'ArrowDown' || key === 'ArrowUp') return { action: { type: 'open', selected } };
    return null;
  }
  switch (key) {
    case 'ArrowDown': return { action: { type: 'move', delta: 1 } };
    case 'ArrowUp': return { action: { type: 'move', delta: -1 } };
    case 'Home': return { action: { type: 'first' } };
    case 'End': return { action: { type: 'last' } };
    case 'Enter': case ' ': return { pick: true, action: { type: 'close' }, refocus: true };
    case 'Escape': return { action: { type: 'close' }, refocus: true };
    case 'Tab': return { action: { type: 'close' } };
    default: return null;
  }
}
