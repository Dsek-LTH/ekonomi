"use client";

import Link from "next/link";

import { cn } from "@/lib/ui/utils";

// "Which collection am I looking at?" — the track register, and the app's
// answer to that question everywhere it is asked.
//
// See components/ui/segmented-control.tsx for the grammar the switchers share.
// This is the coarsest of them: it changes *what* the page is a list of, and
// the page's own title stays put while it does — the track is what says which
// one you are on, so a heading that said it again would be saying it twice.
//
// Two ways of switching, one appearance. "Mina | Alla" is a query parameter on
// one page; "Att bokföra | Bokförda" is two pages. That difference matters to
// the router and to nobody else, so the caller declares `onChange` or `href`
// and gets the same control either way — which is the whole point, because the
// two used to look like different kinds of thing.
//
// Never rendered directly by a page: it is `PageShell`'s `collections` prop, so
// that where it sits is decided once rather than per screen.
export interface CollectionOption {
  value: string;
  label: string;
  /** Shown muted after the label — "Att bokföra 12". */
  count?: number;
}

export type Collections = {
  /** Names the group for a screen reader: "Omfattning", "Avsnitt". */
  label: string;
  /** Which option is current. */
  value: string;
  options: CollectionOption[];
} & (
  // One or the other, never both and never a mixture. Declared at the group
  // rather than per option so a set cannot be half links and half buttons —
  // that would be two controls wearing one appearance, which is the thing this
  // component exists to stop.
  | { href: (value: string) => string; onChange?: never }
  | { onChange: (value: string) => void; href?: never }
);

const TRACK = "inline-flex rounded-full border border-border bg-surface p-1";

const item = (active: boolean) =>
  cn(
    "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
    active
      ? "bg-background text-foreground shadow-[var(--shadow-card)]"
      : "text-muted hover:text-foreground",
  );

const Count = ({ count }: { count?: number }) =>
  count ? <span className="ml-1.5 tabular-nums text-muted">{count}</span> : null;

export function CollectionSwitch({ label, value, options, href, onChange }: Collections) {
  // Links when the collections are pages. A <nav> with real hrefs, so they can
  // be opened in a new tab, prefetched and restored on a reload — none of which
  // a button pretending to navigate can do.
  if (href) {
    return (
      <nav aria-label={label} className={TRACK}>
        {options.map((o) => (
          <Link
            key={o.value}
            href={href(o.value)}
            aria-current={o.value === value ? "page" : undefined}
            className={item(o.value === value)}
          >
            {o.label}
            <Count count={o.count} />
          </Link>
        ))}
      </nav>
    );
  }

  return (
    <div role="tablist" aria-label={label} className={TRACK}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange?.(o.value)}
          className={item(o.value === value)}
        >
          {o.label}
          <Count count={o.count} />
        </button>
      ))}
    </div>
  );
}
