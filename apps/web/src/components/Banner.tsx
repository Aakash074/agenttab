import { BANNER } from '../config';

const Item = ({ href, children }: { href: string; children: React.ReactNode }) =>
  href ? (
    <a href={href} target="_blank" rel="noreferrer" className="shrink-0 text-fg underline decoration-line-2 underline-offset-2 hover:decoration-bch">{children}</a>
  ) : (
    <span className="shrink-0 opacity-60" title="Link added before submission">{children} (soon)</span>
  );

/** Top-of-page banner required by the BCH BLAZE rules. */
export function Banner() {
  return (
    <div className="border-b border-line bg-panel-2 text-[13px] font-medium text-muted">
      <div className="mx-auto flex max-w-6xl items-center gap-x-4 gap-y-1.5 overflow-x-auto whitespace-nowrap px-4 py-2 [scrollbar-width:none] sm:flex-wrap sm:gap-x-5 sm:overflow-visible sm:whitespace-normal">
        <span className="shrink-0 font-semibold text-fg"><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-bch align-middle" />{BANNER.event} entry</span>
        <Item href={BANNER.deckUrl}>Widget Factory deck</Item>
        <Item href={BANNER.repoUrl}>Source code</Item>
        <Item href={BANNER.prototypeUrl}>Pre-hackathon prototype (disclosure)</Item>
        <span className="flex shrink-0 items-center gap-2 sm:min-w-0 sm:max-w-full sm:shrink sm:ml-auto">
          <span className="whitespace-nowrap">Vote with EMBER2026:</span>
          <code className="truncate rounded border border-line bg-panel px-1.5 py-0.5 font-mono text-[12px] text-fg">
            {BANNER.donationZAddress || 'bitcoincash:z… (added before submission)'}
          </code>
        </span>
      </div>
    </div>
  );
}
