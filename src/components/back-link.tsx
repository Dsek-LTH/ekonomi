"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

import { useBackTarget } from "@/components/shell/route-history";
import { useHistoryGo } from "@/components/shell/route-progress";
import { IconChevronLeft } from "@/components/ui/icons";

/**
 * The "← <parent>" link at the top of a nested page.
 *
 * It always says where it goes and always goes where it says. What it works
 * out is *which* parent, because a nested page has more than one: an utlägg is
 * opened from Utlägg, from Attest, from Bokföring and from Översikt, and the
 * page can only name one of them. Naming Utlägg meant that opening something
 * from Bokföring and coming back put you somewhere you had never been.
 *
 * So the destination is the nearest place behind you that the declared parent
 * stands for: the list you actually came from, with the query it had, at
 * whatever depth it sits, and the declared parent itself when there is no
 * such place: a link someone sent you, or a reload of a trip that started
 * before this tab did. See lib/ui/history-stack for the rule, and
 * components/shell/route-history for where the stack comes from.
 *
 * When the destination is somewhere behind us, a plain click *goes* back
 * rather than pushing the URL forward. That is what restores the scroll
 * position and the router's cached render of the page; pushing would land you
 * at the top of a freshly fetched list, which is where you were only in the
 * sense that the address matched, and would leave the page you just left
 * sitting in front of you on the Back button.
 */
export function BackLink({ href, label }: { href: string; label: string }) {
  const tNav = useTranslations("nav");
  const target = useBackTarget(href);
  const go = useHistoryGo();

  // `target.section` is set only when what we found was a section rather than
  // the declared parent, and the nav's name for it is the honest label. The
  // page's own label is right in every other case, including the common one
  // where the parent it declared is the section we found.
  const text = target?.section ? tNav(target.section) : label;

  return (
    <Link
      href={target?.url ?? href}
      onClick={(e) => {
        if (!target) return;
        // Anything but a plain left click is opening this elsewhere, and the
        // href above is what should be opened.
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
          return;
        }
        e.preventDefault();
        go(target.delta);
      }}
      className="-ml-1 mb-2 inline-flex items-center gap-1 rounded-lg px-1 py-0.5 text-sm text-muted transition-colors hover:text-foreground"
    >
      <IconChevronLeft className="size-4 shrink-0" />
      {text}
    </Link>
  );
}
