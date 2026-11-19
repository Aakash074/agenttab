// Tiny in-memory rate limiter: at most `max` hits per `windowMs` per key.
import type { IncomingMessage } from 'node:http';

export class RateLimiter {
  private hits = new Map<string, number[]>();
  private max: number;
  private windowMs: number;
  constructor(max: number, windowMs: number) { this.max = max; this.windowMs = windowMs; }

  /** Returns 0 if allowed (and records the hit), else ms until the next allowed hit. */
  take(key: string, now = Date.now()): number {
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (list.length >= this.max) {
      this.hits.set(key, list);
      return this.windowMs - (now - list[0]);
    }
    list.push(now);
    this.hits.set(key, list);
    return 0;
  }

  /** Gives back the most recent hit for `key` (e.g. the request it allowed then failed). */
  refund(key: string) {
    const list = this.hits.get(key);
    if (list?.length) list.pop();
  }
}

/**
 * Takes one hit from each limiter in order. If any refuses, the hits already taken are refunded, so a refusal
 * by one limit never costs quota in another. `refund()` gives back all hits (call it when the work then fails).
 */
export function takeAll(limits: [RateLimiter, string][], now = Date.now()) {
  const done: [RateLimiter, string][] = [];
  const refund = () => { for (const [l, k] of done.splice(0)) l.refund(k); };
  for (const [l, k] of limits) {
    const wait = l.take(k, now);
    if (wait) { refund(); return { wait, refund }; }
    done.push([l, k]);
  }
  return { wait: 0, refund };
}

/** Client IP; trusts X-Forwarded-For only when TRUST_PROXY=1. */
export function clientIp(req: IncomingMessage, trustProxy: boolean) {
  const fwd = trustProxy ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() : '';
  return fwd || req.socket.remoteAddress || 'unknown';
}
