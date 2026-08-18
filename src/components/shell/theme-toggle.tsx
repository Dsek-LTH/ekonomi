"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { IconSun, IconMoon } from "../ui/icons";
import { themeCookie, type Theme } from "@/lib/ui/theme";

export function ThemeToggle({ initial }: { initial: Theme }) {
  const t = useTranslations("common.themeMode");
  // Handed in by the server, which read the cookie — so the button draws the
  // right icon on the first paint instead of settling into it afterwards. That
  // is what a preference the request carries buys: there is no moment where the
  // page knows the theme and this button doesn't. See lib/ui/theme.ts.
  const [theme, setTheme] = useState<Theme>(initial);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    // The class is flipped here rather than left to the next request: the cookie
    // is what the *server* renders from, and waiting for a round trip to change
    // colour would make a toggle feel like a navigation.
    document.documentElement.classList.toggle("dark", next === "dark");
    document.cookie = themeCookie(next);
  }

  const Icon = theme === "dark" ? IconMoon : IconSun;
  return (
    <button
      onClick={toggle}
      title={t("hint", { mode: t(theme) })}
      aria-label={t("current", { mode: t(theme) })}
      className="flex size-9 items-center justify-center rounded-full border border-border bg-background text-muted transition-colors hover:bg-surface hover:text-foreground"
    >
      <Icon className="size-[18px]" />
    </button>
  );
}
