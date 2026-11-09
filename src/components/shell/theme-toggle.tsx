"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/ui/utils";
import { IconSun, IconMoon } from "../ui/icons";
import { resolvedTheme, themeCookie, type Theme } from "@/lib/ui/theme";

export function ThemeToggle({ round = false }: { round?: boolean }) {
  const t = useTranslations("common.themeMode");

  function toggle() {
    const root = document.documentElement;
    const next: Theme = resolvedTheme(root) === "dark" ? "light" : "dark";
    root.classList.toggle("dark", next === "dark");
    root.classList.toggle("light", next === "light");
    document.cookie = themeCookie(next);
  }

  return (
    <button
      onClick={toggle}
      title={t("toggle")}
      aria-label={t("toggle")}
      className={cn(
        "flex size-9 items-center justify-center border border-border-control bg-background text-muted transition-colors hover:bg-hover hover:text-foreground",
        round ? "rounded-full" : "rounded-control",
      )}
    >
      <IconSun aria-hidden className="size-[18px] dark:hidden" />
      <IconMoon aria-hidden className="hidden size-[18px] dark:block" />
    </button>
  );
}
