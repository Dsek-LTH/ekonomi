"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/ui/utils";
import { IconSun, IconMoon } from "../ui/icons";
import { resolvedTheme, themeCookie, type Theme } from "@/lib/ui/theme";
import { switchTheme } from "@/lib/ui/theme-transition";

function apply(next: Theme) {
  const root = document.documentElement;
  root.classList.toggle("dark", next === "dark");
  root.classList.toggle("light", next === "light");
  document.cookie = themeCookie(next);
}

export function ThemeToggle({ round = false }: { round?: boolean }) {
  const t = useTranslations("common.themeMode");

  function toggle() {
    const next: Theme = resolvedTheme(document.documentElement) === "dark" ? "light" : "dark";
    switchTheme(next, () => apply(next));
  }

  return (
    <button
      onClick={toggle}
      title={t("toggle")}
      aria-label={t("toggle")}
      className={cn(
        "relative flex size-9 items-center justify-center overflow-hidden border border-border-control bg-background text-muted transition-colors hover:bg-hover hover:text-foreground",
        round ? "rounded-full" : "rounded-control",
      )}
    >
      <IconSun
        aria-hidden
        data-theme-icon
        className="theme-icon size-[18px] dark:-rotate-90 dark:scale-0 dark:opacity-0"
      />
      <IconMoon
        aria-hidden
        data-theme-icon
        className="theme-icon absolute size-[18px] rotate-90 scale-0 opacity-0 dark:rotate-0 dark:scale-100 dark:opacity-100"
      />
    </button>
  );
}
