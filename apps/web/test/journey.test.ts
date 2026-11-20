import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  JOURNEY_CAP_SATS, assertJourneyWallet, centsToSats, journeyBudget, journeyCalls, journeyWallets, mainnetTabCopy,
} from '../src/lib/journeyPlan.ts';

test('mainnet: the test wallet is never offered, only WizardConnect', () => {
  assert.deepEqual(journeyWallets('mainnet'), ['wizard']);
  assert.throws(() => assertJourneyWallet('mainnet', { kind: 'burner', net: 'mainnet' }), /WizardConnect/);
  assert.throws(() => assertJourneyWallet('mainnet', { kind: 'burner', net: 'chipnet' }));
  assert.throws(() => assertJourneyWallet('mainnet', { kind: 'wizard', net: 'chipnet' }), /connected to chipnet/);
  assert.doesNotThrow(() => assertJourneyWallet('mainnet', { kind: 'wizard', net: 'mainnet' }));
});

test('chipnet unchanged: test wallet first, 3 calls; a WizardConnect wallet runs the mainnet flow (10 calls)', () => {
  assert.deepEqual(journeyWallets('chipnet'), ['burner', 'wizard']);
  assert.equal(journeyCalls('chipnet', 'burner'), 3);
  assert.equal(journeyCalls('chipnet', 'wizard'), 10);
  assert.equal(journeyCalls('mainnet', 'wizard'), 10);
  assert.equal(journeyBudget({ net: 'chipnet', price: 1000n, calls: 3, balance: 25_000n }).budget, 20_000n);
});

test('mainnet budget ≈ 5¢ at the live price, capped, ≥ what N calls + dust need', () => {
  const big = 10n ** 9n;
  const at200 = journeyBudget({ net: 'mainnet', price: 600n, calls: 10, balance: big, bchUsd: 201.55 });
  assert.equal(at200.budget, centsToSats(5, 201.55));
  assert.ok(at200.budget > 24_000n && at200.budget < 25_000n);
  // BCH crashes: 5¢ would be a lot of sats, the cap holds.
  assert.equal(journeyBudget({ net: 'mainnet', price: 600n, calls: 10, balance: big, bchUsd: 50 }).budget, JOURNEY_CAP_SATS);
  // BCH moons: 5¢ is less than 10 calls need; floor at 10*price + dust + settle fee, still ≥ dust.
  const hi = journeyBudget({ net: 'mainnet', price: 600n, calls: 10, balance: big, bchUsd: 5_000 });
  assert.equal(hi.budget, 10n * 600n + 546n + 1_000n);
  assert.ok(hi.budget >= 546n);
  // Wallet holds less than 5¢: capped to what it can afford, refused below the minimum.
  const low = journeyBudget({ net: 'mainnet', price: 600n, calls: 10, balance: 12_000n, bchUsd: 201.55 });
  assert.equal(low.enough, true);
  assert.ok(low.budget <= 12_000n - 600n);
  assert.equal(journeyBudget({ net: 'mainnet', price: 600n, calls: 10, balance: 5_000n, bchUsd: 201.55 }).enough, false);
  // No live price: refuse rather than guess.
  assert.throws(() => journeyBudget({ net: 'mainnet', price: 600n, calls: 10, balance: big }), /live BCH price/);
});

test('mainnet confirmation copy says real BCH, ~5¢, and that the unspent part comes back on settle', () => {
  const c = mainnetTabCopy({ budget: centsToSats(5, 201.55), bchUsd: 201.55, calls: 10, price: 600n });
  assert.match(c.title, /^Real BCH, ~5¢ \(24,8\d\d sats\)$/);
  assert.match(c.body, /10 paid calls/);
  assert.match(c.body, /unspent part returns to your wallet automatically on settle/);
  assert.match(c.refund, /refund/);
});
