// Faster blocks (CHIP-2025-03) activated on chipnet on 2026-11-15: height-based nLockTime now counts
// 10-minute units, so a tab timeout must be compared with the lock tip, not the raw block height.
// These data points were measured on two chipnet nodes (imaginary.cash, bch.ninja) by bisecting the
// highest nLockTime accepted as final ("bad-txns-nonfinal" above it) at each reported tip.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { NetworkProvider } from 'cashscript';
import { FAST_BLOCKS, chainLockTip, lockHeightAt, lockTip } from '../src/index.ts';

const OBSERVED: [tip: number, maxFinalLocktime: number][] = [
  [332678, 332472], [332679, 332472], [332680, 332473], [332687, 332473],
];

test('lockTip reproduces the chipnet nodes\' finality boundary after faster blocks', () => {
  for (const [tip, maxFinal] of OBSERVED) assert.equal(lockTip(tip, 'chipnet'), maxFinal, `tip ${tip}`);
});

test('the stuck refund (timeout 332642) was correctly non-final at raw tip 332673', () => {
  // The old check `tip >= timeout` said yes; the node said bad-txns-nonfinal.
  assert.ok(332673 >= 332642);
  assert.ok(lockTip(332673, 'chipnet') < 332642);
  // It unlocks once the lock tip reaches the timeout: (332642 + 1 - A) * 10 + A - 1 raw.
  const A = FAST_BLOCKS.chipnet!.height;
  const unlockTip = (332642 + 1 - A) * 10 + A - 1;
  assert.equal(lockTip(unlockTip - 1, 'chipnet'), 332641);
  assert.equal(lockTip(unlockTip, 'chipnet'), 332642);
});

test('before activation, and on mainnet, the lock tip is the raw tip (Nov 14 refund at 332319)', () => {
  assert.equal(lockTip(332318, 'chipnet'), 332318); // early refund (timeout 332319) rejected
  assert.equal(lockTip(332319, 'chipnet'), 332319); // refund accepted
  assert.equal(lockTip(FAST_BLOCKS.chipnet!.height - 1, 'chipnet'), FAST_BLOCKS.chipnet!.height - 1);
  for (const h of [0, 800_000, 950_123]) assert.equal(lockTip(h, 'mainnet'), h);
});

test('lock height is monotonic and advances 1 per 10 blocks after activation', () => {
  const A = FAST_BLOCKS.chipnet!.height;
  let prev = lockHeightAt(A - 5, 'chipnet');
  for (let h = A - 4; h < A + 200; h++) {
    const l = lockHeightAt(h, 'chipnet');
    assert.ok(l === prev || l === prev + 1);
    prev = l;
  }
  assert.equal(lockHeightAt(A + 100, 'chipnet') - lockHeightAt(A, 'chipnet'), 10);
});

test('chainLockTip reads the provider tip and converts it', async () => {
  const p = { getBlockHeight: async () => 332687 } as unknown as NetworkProvider;
  assert.equal(await chainLockTip(p, 'chipnet'), 332473);
  assert.equal(await chainLockTip(p, 'mocknet'), 332687);
});
