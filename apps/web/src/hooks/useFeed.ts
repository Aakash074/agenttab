import { useEffect, useState } from 'react';
import { api, type FeedEvent, type Stats } from '../lib/api';

const cacheKey = (k: string) => `agenttab.feed.${k}`;
type Cache = { events: FeedEvent[]; stats: Stats | null; at: number; epoch?: string };
function readCache(k: string): Cache | null {
  try { const c = localStorage.getItem(cacheKey(k)); return c ? JSON.parse(c) : null; } catch { return null; }
}

/** After this long without a first answer, the (free-tier) API is probably waking from sleep. */
export const WAKE_AFTER_MS = 3000;

/** Initial /feed snapshot, then live updates over SSE (falls back to polling). The last good snapshot is
 *  cached locally so the page never goes blank while the API reconnects. */
export function useFeed(key: string) {
  const cached = readCache(key);
  const [events, setEvents] = useState<FeedEvent[]>(cached?.events ?? []);
  const [stats, setStats] = useState<Stats | null>(cached?.stats ?? null);
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSeen, setLastSeen] = useState<number | null>(cached?.at ?? null);
  const [answered, setAnswered] = useState(false);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    let closed = false;
    let es: EventSource | undefined;
    const c = readCache(key);
    let epoch = c?.epoch;
    let ok = false;
    setEvents(c?.events ?? []); setStats(c?.stats ?? null); setLastSeen(c?.at ?? null);
    setAnswered(false); setSlow(false);
    const wake = setTimeout(() => !closed && setSlow(true), WAKE_AFTER_MS);
    const merge = (incoming: FeedEvent[]) =>
      setEvents((prev) => {
        const seen = new Set(prev.map((e) => e.id));
        const add = incoming.filter((e) => !seen.has(e.id));
        return add.length ? [...add, ...prev].sort((a, b) => b.id - a.id).slice(0, 80) : prev;
      });
    let inflight = false, again = false;
    const refresh = (): void => { if (inflight) { again = true; return; } inflight = true; api.feed().then((f) => {
      if (closed) return;
      // A restarted server (or a chain replay) renumbers events: drop the old list instead of mixing ids.
      if (f.epoch !== epoch) { epoch = f.epoch; setEvents(f.events); } else merge(f.events);
      ok = true; setStats(f.stats); setError(null); setAnswered(true); setSlow(false); clearTimeout(wake);
      const at = Date.now(); setLastSeen(at);
      try { localStorage.setItem(cacheKey(key), JSON.stringify({ events: f.events.slice(0, 80), stats: f.stats, at, epoch })); } catch { /* storage full/blocked */ }
    }).catch((e) => !closed && setError(String(e.message ?? e))).finally(() => { inflight = false; if (again && !closed) { again = false; refresh(); } }); };
    let soon: ReturnType<typeof setTimeout> | undefined;
    const refreshSoon = () => { clearTimeout(soon); soon = setTimeout(refresh, 250); };
    refresh();
    const connect = () => {
      try {
        es = new EventSource(api.streamUrl());
        es.onopen = () => { setLive(true); refresh(); };
        es.onmessage = refreshSoon;
        es.onerror = () => setLive(false);
      } catch { /* no SSE */ }
    };
    connect();
    // Faster retries until the server first answers (cold start), then the normal 10 s poll.
    let poll = setInterval(refresh, 4_000);
    const relax = setInterval(() => { if (!closed && ok) { clearInterval(poll); poll = setInterval(refresh, 10_000); clearInterval(relax); } }, 1_000);
    return () => { closed = true; es?.close(); clearInterval(poll); clearInterval(relax); clearTimeout(wake); clearTimeout(soon); };
  }, [key]);

  return { events, stats, live, error, lastSeen, stale: !!error, waking: !answered && (slow || !!error) };
}
