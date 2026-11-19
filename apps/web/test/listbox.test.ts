import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyToAction, listboxReducer, step, type ListboxState } from '../src/lib/listbox.ts';

const opts = [{}, {}];                    // Mainnet, Chipnet
const optsMainOff = [{ disabled: true }, {}]; // Mainnet disabled (no mainnet server configured)

/** Drive the listbox with a key sequence starting closed with `selected` chosen; returns picks and final state. */
function press(keys: string[], selected: number, options = opts) {
  let s: ListboxState = { open: false, active: selected };
  const picks: number[] = []; let refocused = 0;
  for (const k of keys) {
    const r = keyToAction(k, s.open, selected);
    if (!r) continue;
    if (r.pick) { picks.push(s.active); selected = s.active; }
    if (r.action) s = listboxReducer(options, s, r.action);
    if (r.refocus) refocused++;
  }
  return { s, picks, refocused };
}

test('open and close: Enter opens on the current network, Escape closes and returns focus', () => {
  const opened = press(['Enter'], 0);
  assert.deepEqual(opened.s, { open: true, active: 0 });
  const closed = press(['Enter', 'Escape'], 0);
  assert.equal(closed.s.open, false);
  assert.equal(closed.refocused, 1);
  assert.deepEqual(closed.picks, []);
  // toggle (click) opens then closes
  let s: ListboxState = { open: false, active: 1 };
  s = listboxReducer(opts, s, { type: 'toggle', selected: 1 }); assert.equal(s.open, true);
  s = listboxReducer(opts, s, { type: 'toggle', selected: 1 }); assert.equal(s.open, false);
});

test('keyboard selection: ArrowDown + Enter picks Chipnet; arrows wrap; Space also picks', () => {
  assert.deepEqual(press(['ArrowDown', 'ArrowDown', 'Enter'], 0).picks, [1]);  // open on Mainnet, move to Chipnet, pick
  assert.deepEqual(press(['Enter', 'ArrowDown', 'ArrowDown', ' '], 0).picks, [0]); // wraps back to Mainnet
  assert.deepEqual(press([' ', 'End', 'Enter'], 0).picks, [1]);
  assert.deepEqual(press(['ArrowUp', 'Home', 'Enter'], 1).picks, [0]);
  // Tab closes without picking and hands focus back to the trigger (not to <body>); letters are ignored
  const t = press(['Enter', 'x', 'Tab'], 0);
  assert.equal(t.s.open, false); assert.deepEqual(t.picks, []); assert.equal(t.refocused, 1);
});

test('disabled options are skipped', () => {
  assert.equal(step(optsMainOff, 1, 1), 1);
  assert.deepEqual(press(['Enter', 'ArrowDown', 'Enter'], 1, optsMainOff).picks, [1]);
  assert.deepEqual(listboxReducer(optsMainOff, { open: false, active: 0 }, { type: 'open', selected: 0 }), { open: true, active: 1 });
  assert.deepEqual(listboxReducer(optsMainOff, { open: true, active: 1 }, { type: 'hover', index: 0 }), { open: true, active: 1 });
});
