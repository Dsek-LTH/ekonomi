"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/ui/utils";
import { IconSun, IconMoon } from "../ui/icons";
import { resolvedTheme, themeCookie, type Theme } from "@/lib/ui/theme";

/**
 * The light/dark switch.
 *
 * It takes no prop saying which theme it is in, and cannot: the reader may not
 * have said, in which case the answer is whatever their OS says and the server
 * does not know it (see lib/ui/theme.ts). So the button says both, and the
 * palette's own `dark` variant hides the wrong one. That is a rule the
 * stylesheet already evaluates on every paint, class or media query alike, so
 * the icon is right in the markup the parser reads and there is still nothing
 * to correct afterwards.
 *
 * The label is the action rather than the state for the same reason: an
 * aria-label cannot be switched in CSS, and one that named the current mode
 * would be a sentence the server had to guess. "Byt färgtema" is also the
 * better label, since what a button announces should be what pressing it does.
 */
export function ThemeToggle({ round = false }: { round?: boolean }) {
  const t = useTranslations("common.themeMode");

  function toggle() {
    const root = document.documentElement;
    const next: Theme = resolvedTheme(root) === "dark" ? "light" : "dark";
    // Both classes are written, never just the one. An explicit light has to be
    // a class of its own, because on a machine set to dark the absence of
    // `dark` is what *defers* to the OS rather than what refuses it.
    root.classList.toggle("dark", next === "dark");
    root.classList.toggle("light", next === "light");
    // The class is flipped here rather than left to the next request: the cookie
    // is what the *server* renders from, and waiting for a round trip to change
    // colour would make a toggle feel like a navigation.
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
