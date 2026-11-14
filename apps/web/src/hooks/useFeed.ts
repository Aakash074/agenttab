import { useEffect, useState } from 'react';
import { api, type FeedEvent, type Stats } from '../lib/api';

const cacheKey = (k: string) => `agenttab.feed.${k}`;
type Cache = { events: FeedEvent[]; stats: Stats | null; at: number };
function readCache(k: string): Cache | null {
  try { const c = localStorage.getItem(cacheKey(k)); return c ? JSON.parse(c) : null; } catch { return null; }
}

/** Initial /feed snapshot, then live updates over SSE (falls back to polling). The last good snapshot is
 *  cached locally so the page never goes blank while the API reconnects. */
export function useFeed(key: string) {
  const cached = readCache(key);
  const [events, setEvents] = useState<FeedEvent[]>(cached?.events ?? []);
  const [stats, setStats] = useState<Stats | null>(cached?.stats ?? null);
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSeen, setLastSeen] = useState<number | null>(cached?.at ?? null);

  useEffect(() => {
    let closed = false;
    let es: EventSource | undefined;
    const c = readCache(key);
    setEvents(c?.events ?? []); setStats(c?.stats ?? null); setLastSeen(c?.at ?? null);
    const merge = (incoming: FeedEvent[]) =>
      setEvents((prev) => {
        const seen = new Set(prev.map((e) => e.id));
        const add = incoming.filter((e) => !seen.has(e.id));
        // A restarted server may renumber events: if ids went backwards, take the server's list.
        if (incoming.length && prev.length && Math.max(...incoming.map((e) => e.id)) < Math.min(...prev.map((e) => e.id))) return incoming;
        return add.length ? [...add, ...prev].sort((a, b) => b.id - a.id).slice(0, 80) : prev;
      });
    const refresh = () => api.feed().then((f) => {
      if (closed) return;
      setStats(f.stats); merge(f.events); setError(null);
      const at = Date.now(); setLastSeen(at);
      try { localStorage.setItem(cacheKey(key), JSON.stringify({ events: f.events.slice(0, 80), stats: f.stats, at })); } catch { /* storage full/blocked */ }
    }).catch((e) => !closed && setError(String(e.message ?? e)));
    refresh();
    const connect = () => {
      try {
        es = new EventSource(api.streamUrl());
        es.onopen = () => { setLive(true); refresh(); };
        es.onmessage = (m) => { merge([JSON.parse(m.data)]); refresh(); };
        es.onerror = () => setLive(false);
      } catch { /* no SSE */ }
    };
    connect();
    const poll = setInterval(refresh, 10_000);
    return () => { closed = true; es?.close(); clearInterval(poll); };
  }, [key]);

  return { events, stats, live, error, lastSeen, stale: !!error };
}
