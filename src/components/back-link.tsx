"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

import { useGoBack } from "@/components/shell/route-history";
import { IconChevronLeft } from "@/components/ui/icons";

/**
 * The way back from a nested page, as an arrow before its title, on the
 * title's own line. It does what the browser's Back button does, so it returns
 * you to the list you came from with its query and scroll position as they
 * were. `href` is the page's parent, for when there is nothing in the app
 * behind you. See useGoBack.
 *
 * It was the word "Tillbaka" on a line of its own above the title, which cost
 * every page under a section a line of header and repeated what the section's
 * band above already says (where you are, and the tab you came from). The
 * word is still its name, for a screen reader and on hover.
 */
export function BackLink({ href }: { href: string }) {
  const t = useTranslations("common");
  const back = useGoBack(href);

  return (
    <Link
      href={back.href}
      onClick={back.onClick}
      aria-label={t("back")}
      title={t("back")}
      // The height of the title's line, so the arrow sits on it whatever the
      // title wraps to below.
      className="-ml-1.5 flex size-8 shrink-0 items-center justify-center rounded-control text-muted transition-colors hover:bg-hover hover:text-foreground"
    >
      <IconChevronLeft className="size-5" />
    </Link>
  );
}
