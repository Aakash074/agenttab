import { BANNER } from '../config';

const Item = ({ href, children }: { href: string; children: React.ReactNode }) =>
  href ? (
    <a href={href} target="_blank" rel="noreferrer" className="text-fg underline decoration-line-2 underline-offset-2 hover:decoration-bch">{children}</a>
  ) : (
    <span className="opacity-60" title="Link added before submission">{children} (soon)</span>
  );

/** Top-of-page banner required by the BCH BLAZE rules. */
export function Banner() {
  return (
    <div className="border-b border-line bg-panel-2 text-[13px] font-medium text-muted">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2 sm:gap-x-5">
        <span className="shrink-0 font-semibold text-fg"><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-bch align-middle" />{BANNER.event} entry</span>
        <Item href={BANNER.deckUrl}>Widget Factory deck</Item>
        <Item href={BANNER.repoUrl}>Source code</Item>
        <Item href={BANNER.prototypeUrl}>Pre-hackathon prototype (disclosure)</Item>
        <span className="flex min-w-0 max-w-full items-center gap-2 sm:ml-auto">
          <span className="whitespace-nowrap">Vote with EMBER2026:</span>
          <code className="truncate rounded border border-line bg-panel px-1.5 py-0.5 font-mono text-[12px] text-fg">
            {BANNER.donationZAddress || 'bitcoincash:z… (added before submission)'}
          </code>
        </span>
      </div>
    </div>
  );
}
