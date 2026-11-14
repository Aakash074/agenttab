import { useEffect, useState } from 'react';

export type ThemeChoice = 'light' | 'dark' | 'system';
const KEY = 'agenttab.theme';

const read = (): ThemeChoice => {
  try { const v = localStorage.getItem(KEY); return v === 'dark' || v === 'system' ? v : 'light'; } catch { return 'light'; }
};

/** Light by default; dark or "follow the OS" on request. Resolved theme is reported for components that need colors. */
export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(read);
  const [osDark, setOsDark] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    document.documentElement.dataset.theme = choice;
    try { localStorage.setItem(KEY, choice); } catch { /* ignore */ }
  }, [choice]);
  useEffect(() => {
    const m = matchMedia('(prefers-color-scheme: dark)');
    const f = () => setOsDark(m.matches);
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, []);
  const resolved: 'light' | 'dark' = choice === 'system' ? (osDark ? 'dark' : 'light') : choice;
  const next = () => setChoice((c) => (c === 'light' ? 'dark' : c === 'dark' ? 'system' : 'light'));
  return { choice, resolved, next };
}
