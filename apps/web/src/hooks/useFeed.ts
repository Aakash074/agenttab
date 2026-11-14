import { useEffect, useState } from 'react';
import { api, type FeedEvent, type Stats } from '../lib/api';

/** Initial /feed snapshot, then live updates over SSE (falls back to polling). */
export function useFeed(key: string) {
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let closed = false;
    let es: EventSource | undefined;
    let poll: ReturnType<typeof setInterval> | undefined;
    const merge = (incoming: FeedEvent[]) =>
      setEvents((prev) => {
        const seen = new Set(prev.map((e) => e.id));
        const add = incoming.filter((e) => !seen.has(e.id));
        return add.length ? [...add, ...prev].sort((a, b) => b.id - a.id).slice(0, 80) : prev;
      });
    const refresh = () => api.feed().then((f) => { if (!closed) { setStats(f.stats); merge(f.events); setError(null); } })
      .catch((e) => !closed && setError(String(e.message ?? e)));
    setEvents([]);
    refresh();
    try {
      es = new EventSource(api.streamUrl());
      es.onopen = () => setLive(true);
      es.onmessage = (m) => { merge([JSON.parse(m.data)]); refresh(); };
      es.onerror = () => setLive(false);
    } catch { /* no SSE */ }
    poll = setInterval(refresh, 20_000);
    return () => { closed = true; es?.close(); if (poll) clearInterval(poll); };
  }, [key]);

  return { events, stats, live, error };
}
