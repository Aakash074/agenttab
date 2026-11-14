import { BANNER } from '../config';

const Item = ({ href, children }: { href: string; children: React.ReactNode }) =>
  href ? (
    <a href={href} target="_blank" rel="noreferrer" className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink">{children}</a>
  ) : (
    <span className="opacity-60" title="Link added before submission">{children} (soon)</span>
  );

/** Top-of-page banner required by the BCH BLAZE rules. */
export function Banner() {
  return (
    <div className="bg-bch text-ink text-[13px] font-medium">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-1 px-4 py-2">
        <span className="font-bold">{BANNER.event} entry</span>
        <Item href={BANNER.deckUrl}>Widget Factory deck</Item>
        <Item href={BANNER.repoUrl}>Source code</Item>
        <Item href={BANNER.prototypeUrl}>Pre-hackathon prototype (disclosure)</Item>
        <span className="flex min-w-0 max-w-full items-center gap-2 sm:ml-auto">
          <span className="whitespace-nowrap">Vote with EMBER2026:</span>
          <code className="truncate rounded bg-ink/10 px-1.5 py-0.5 font-mono text-[12px]">
            {BANNER.donationZAddress || 'bitcoincash:z… (added before submission)'}
          </code>
        </span>
      </div>
    </div>
  );
}
