import { useState } from 'react';
import { BANNER } from '../config';
import { short } from '../lib/format';

const Chip = ({ href, label, sub }: { href: string; label: string; sub?: string }) => (
  <a href={href} target="_blank" rel="noreferrer" className="chip">
    <span className="font-medium text-fg">{label}</span>{sub && <span className="text-dim">{sub}</span>}<span aria-hidden className="text-dim">↗</span>
  </a>
);

/** Footer: what this is, the BLAZE links as chips (deck, source, disclosure, vote address), and the phone theme switch. */
export function Footer({ themeLabel, onTheme }: { themeLabel: string; onTheme: () => void }) {
  const [copied, setCopied] = useState(false);
  const z = BANNER.donationZAddress;
  return (
    <footer className="site-footer">
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-9 md:grid-cols-[1fr_auto] md:items-end">
        <div className="max-w-md">
          <p className="flex items-center gap-2 text-[15px] font-semibold text-fg">
            <svg width="20" height="20" viewBox="0 0 32 32" aria-hidden><rect width="32" height="32" rx="8" className="fill-bch" /><path d="M9 22V10h7.5a4 4 0 0 1 0 8H13m0-8v12" className="stroke-on-bch" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
            AgentTab
          </p>
          <p className="mt-2 text-sm leading-relaxed text-muted">A bar tab for AI agents on Bitcoin Cash: lock a few cents once, pay per call with signed vouchers, get the change back.</p>
          <p className="mt-3 font-mono text-[11.5px] text-dim">BCH BLAZE 2026 · CashScript covenant · WizardConnect · MCP</p>
        </div>
        <div className="flex flex-wrap gap-2 md:justify-end">
          {BANNER.deckUrl && <Chip href={BANNER.deckUrl} label="Deck" />}
          {BANNER.repoUrl && <Chip href={BANNER.repoUrl} label="Source" sub="GitHub" />}
          {BANNER.prototypeUrl && <Chip href={BANNER.prototypeUrl} label="Prototype" sub="disclosure" />}
          {z && (
            <button type="button" className="chip" title={`Vote with EMBER2026 tokens: ${z}`}
              onClick={() => { navigator.clipboard?.writeText(z); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
              <span className="font-medium text-fg">Vote</span>
              <span className="font-mono text-[12px] text-dim">{copied ? 'address copied' : short(z.split(':')[1] ?? z, 6)}</span>
              {!copied && <svg aria-hidden width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-dim"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>}
            </button>
          )}
          <button type="button" onClick={onTheme} className="chip sm:hidden"><span className="font-medium text-fg">{themeLabel}</span></button>
        </div>
      </div>
    </footer>
  );
}
