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
}

/** Client IP; trusts X-Forwarded-For only when TRUST_PROXY=1. */
export function clientIp(req: IncomingMessage, trustProxy: boolean) {
  const fwd = trustProxy ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() : '';
  return fwd || req.socket.remoteAddress || 'unknown';
}
