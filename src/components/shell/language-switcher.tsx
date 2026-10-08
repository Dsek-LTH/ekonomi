"use client";

import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";
import { cn } from "@/lib/ui/utils";
import { startRouteProgress } from "@/components/shell/route-progress";
import { FlagSE, FlagGB } from "@/components/ui/icons";

const LOCALES = [
  { value: "sv", label: "Svenska", Flag: FlagSE },
  { value: "en", label: "English", Flag: FlagGB },
] as const;

function writeLocaleCookie(next: string) {
  document.cookie = `NEXT_LOCALE=${next}; path=/; max-age=31536000; samesite=lax`;
}

export function LanguageSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // This one keeps its own transition rather than going through
  // useProgressRouter: the dimmed flags below are its local feedback, and it
  // needs the flag for that. The bar is told separately.
  useEffect(() => {
    if (!pending) return;
    return startRouteProgress();
  }, [pending]);

  const select = (next: string) => {
    if (next === locale) return;
    writeLocaleCookie(next);
    startTransition(() => router.refresh());
  };

  return (
    <div className={cn("flex gap-2.5", pending && "opacity-60")}>
      {LOCALES.map(({ value, label, Flag }) => (
        <button
          key={value}
          type="button"
          onClick={() => select(value)}
          aria-label={label}
          aria-pressed={locale === value}
          title={label}
          className={cn(
          "overflow-hidden flex size-9 items-center justify-center rounded-control border border-border bg-background text-muted transition-colors hover:bg-hover hover:text-foreground",
            locale === value
              ? ""
              : "border-border opacity-50 hover:opacity-100 focus:opacity-100",
          )}
        >
          <Flag className="size-[24px] rounded-full" />
        </button>
      ))}
    </div>
  );
}
