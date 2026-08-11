"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

import { SECTION_LABELS } from "@/components/shell/app-shell";
import { useLastSection, usePreviousRoute } from "@/components/shell/route-history";
import { useProgressRouter } from "@/components/shell/route-progress";
import { IconChevronLeft } from "@/components/ui/icons";
import { routePath, samePath } from "@/lib/ui/routes";

/**
 * The "← <parent>" link at the top of a nested page.
 *
 * It always says where it goes and always goes where it says. What it works out
 * is *which* parent, because a nested page has more than one: an utlägg is
 * opened from Utlägg, from Attest, from Bokföring and from Översikt, and the
 * page can only name one of them. Naming Utlägg meant that opening something
 * from Bokföring and coming back put you somewhere you had never been.
 *
 * So the destination is, in order:
 *
 *   1. the section you were last in, if this page's declared parent is itself a
 *      section — the list you came from, with the query it had. This is the
 *      *section* rather than the previous page on purpose: going an utlägg deep
 *      and then into its booking screen leaves the previous page pointing at
 *      the utlägg, while the list you came from is still Bokföring;
 *   2. the declared parent, if that is exactly where you came from — same
 *      thing, for a parent that is not a section (the booking screen's utlägg);
 *   3. the declared parent, plain. Arriving from a link someone sent you, or
 *      reloading, has no history to read, and the page's own answer is right.
 *
 * A plain click goes through history when the destination is literally the
 * previous entry, because that restores the scroll position and the router's
 * cached render of the page. Pushing the same URL forward would land you at the
 * top of a freshly fetched list, which is where you were only in the sense that
 * the address matched.
 */
export function BackLink({ href, label }: { href: string; label: string }) {
  const tNav = useTranslations("nav");
  const previous = usePreviousRoute();
  const section = useLastSection();
  const router = useProgressRouter();

  // Only when this page's parent is a list to begin with. The booking screen's
  // parent is one utlägg, and "the section you came from" is not a substitute
  // for it — you would be sent past the thing you were working on.
  const parentIsSection = Boolean(SECTION_LABELS[routePath(href)]);

  const destination =
    section && parentIsSection
      ? { url: section.url, text: tNav(section.label) }
      : previous && samePath(previous, href)
        ? { url: previous, text: label }
        : { url: href, text: label };

  return (
    <Link
      href={destination.url}
      onClick={(e) => {
        // Only when going back one step lands exactly there. Two steps in, the
        // section is still the right destination but history is not the way to
        // reach it — `back()` would stop at whatever is in between.
        if (destination.url !== previous) return;
        // Anything but a plain left click is opening this elsewhere, and the
        // href above is what should be opened.
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
          return;
        }
        e.preventDefault();
        router.back();
      }}
      className="-ml-1 mb-2 inline-flex items-center gap-1 rounded-lg px-1 py-0.5 text-sm text-muted transition-colors hover:text-foreground"
    >
      <IconChevronLeft className="size-4 shrink-0" />
      {destination.text}
    </Link>
  );
}
