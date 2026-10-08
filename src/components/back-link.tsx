"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

import { useGoBack } from "@/components/shell/route-history";
import { IconChevronLeft } from "@/components/ui/icons";

/**
 * The "← Tillbaka" link at the top of a nested page. It does what the
 * browser's Back button does, so it returns you to the list you came from with
 * its query and scroll position as they were. `href` is the page's parent, for
 * when there is nothing in the app behind you. See useGoBack.
 */
export function BackLink({ href }: { href: string }) {
  const t = useTranslations("common");
  const back = useGoBack(href);

  return (
    <Link
      href={back.href}
      onClick={back.onClick}
      className="-ml-1 mb-2 inline-flex items-center gap-1 rounded-control px-1 py-0.5 text-sm text-muted transition-colors hover:text-foreground"
    >
      <IconChevronLeft className="size-4 shrink-0" />
      {t("back")}
    </Link>
  );
}
