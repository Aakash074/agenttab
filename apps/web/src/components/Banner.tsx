import { useEffect, useRef, useState } from 'react';
import { BANNER } from '../config';

const Item = ({ href, children }: { href: string; children: React.ReactNode }) =>
  href ? (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex min-h-[36px] shrink-0 items-center underline decoration-line-2 underline-offset-2 hover:text-fg hover:decoration-bch">{children}</a>
  ) : (
    <span className="shrink-0 opacity-60" title="Link added before submission">{children} (soon)</span>
  );

function Vote() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', off); document.addEventListener('keydown', off);
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', off); };
  }, [open]);
  const addr = BANNER.donationZAddress || 'bitcoincash:z… (added before submission)';
  return (
    <span ref={ref} className="relative ml-auto shrink-0">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="inline-flex min-h-[36px] items-center gap-1 font-medium text-fg hover:text-bch-2">Vote <span aria-hidden className="text-dim">▾</span></button>
      {open && (
        <span className="fade-in absolute right-0 top-full z-50 mt-1 block w-[min(340px,calc(100vw-32px))] rounded-xl border border-line-2 bg-panel p-3 text-left shadow-xl">
          <span className="block text-sm text-fg">Vote for AgentTab with EMBER2026 tokens at:</span>
          <code className="mt-2 block break-all rounded-lg bg-panel-2 px-2 py-1.5 font-mono text-[12px] text-fg">{addr}</code>
          <button type="button" onClick={() => { navigator.clipboard?.writeText(addr); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
            className="mt-2 min-h-[36px] rounded-lg border border-line-2 px-3 text-xs font-medium hover:bg-subtle">{copied ? 'Copied' : 'Copy address'}</button>
        </span>
      )}
    </span>
  );
}

/** Top-of-page banner required by the BCH BLAZE rules: entry, source, disclosure, vote address. */
export function Banner() {
  return (
    <div className="border-b border-line bg-panel-2 text-[12.5px] text-muted">
      <div className="mx-auto flex max-w-6xl items-center gap-x-4 px-4">
        <span className="shrink-0 font-medium text-fg"><span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-bch align-middle" />BCH BLAZE 2026<span className="hidden sm:inline"> entry</span></span>
        {BANNER.deckUrl && <Item href={BANNER.deckUrl}>Deck</Item>}
        <Item href={BANNER.repoUrl}>Source</Item>
        <Item href={BANNER.prototypeUrl}><span className="sm:hidden">Disclosure</span><span className="hidden sm:inline">Pre-hackathon prototype (disclosure)</span></Item>
        <Vote />
      </div>
    </div>
  );
}
