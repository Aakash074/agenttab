import { useState } from 'react';
import { BANNER, PROTOTYPE_PRE_KICKOFF_URL } from '../config';

const Item = ({ href, children }: { href: string; children: React.ReactNode }) =>
  href ? (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex min-h-[34px] shrink-0 items-center underline decoration-line-2 underline-offset-2 hover:text-fg hover:decoration-bch sm:min-h-[36px]">{children}</a>
  ) : (
    <span className="shrink-0 opacity-60" title="Link added before submission">{children} (soon)</span>
  );

/** "zqcgm29z…fnnrul": the CashTokens address without its prefix, shortened for the banner. */
const shortZ = (a: string) => { const s = a.split(':').pop() ?? a; return s.length > 18 ? `${s.slice(0, 8)}…${s.slice(-6)}` : s; };

/** The EMBER2026 vote address, shown in the banner itself with a Copy button (BLAZE rule: the banner contains it). */
function Vote() {
  const [copied, setCopied] = useState(false);
  const addr = BANNER.donationZAddress;
  if (!addr) return <span className="shrink-0 opacity-60">Vote address (soon)</span>;
  return (
    <span className="inline-flex min-h-[34px] shrink-0 items-center gap-1.5 sm:min-h-[36px]" title={`Vote for AgentTab with EMBER2026 tokens at ${addr}`}>
      <span className="font-medium text-fg">Vote:</span>
      <code className="font-mono text-[12px] text-fg" aria-label={addr}>{shortZ(addr)}</code>
      <button type="button" onClick={() => { navigator.clipboard?.writeText(addr); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
        aria-label="Copy the EMBER2026 vote address"
        className="min-h-[28px] rounded-md border border-line-2 bg-panel/70 px-2 text-[11.5px] font-medium text-fg hover:bg-subtle">{copied ? 'Copied' : 'Copy'}</button>
    </span>
  );
}

/** Top-of-page banner required by the BCH BLAZE rules: Widget Factory deck, source, disclosure, vote address. */
export function Banner() {
  return (
    <div className="site-banner text-[12.5px] text-muted">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 px-4 sm:gap-x-4">
        <span className="shrink-0 font-medium text-fg"><span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-bch align-middle" />BCH BLAZE 2026<span className="hidden sm:inline"> entry</span></span>
        {BANNER.deckUrl && <Item href={BANNER.deckUrl}>Widget Factory deck</Item>}
        <Item href={BANNER.repoUrl}>Source</Item>
        {/* Phones: the second row holds the disclosure and the vote address. */}
        <span className="flex basis-full items-center gap-x-2.5 sm:contents">
          <Item href={PROTOTYPE_PRE_KICKOFF_URL}><span className="sm:hidden">Prototype (no demo)</span><span className="hidden sm:inline lg:hidden">Prototype (no demo existed)</span><span className="hidden lg:inline">Pre-hackathon prototype (no hosted demo existed)</span></Item>
          <span className="ml-auto shrink-0"><Vote /></span>
        </span>
      </div>
    </div>
  );
}
