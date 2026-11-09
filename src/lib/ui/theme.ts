// The theme as a cookie, so the server renders <html class="dark"> with no inline script or flash.
// No directive: imported by both client and server components, so no `next/headers` and no "use client".
export const THEME_COOKIE = "theme";

export type Theme = "light" | "dark";

/**
 * What the reader has said. `null` means "has not said" (not light): the class is absent and `prefers-color-scheme`
 * decides. An explicit light is a `light` class, so it can override a dark OS.
 */
type ThemeChoice = Theme | null;

/** Reads a stored preference. Anything that is neither theme is "has not said" (this also absorbs the old "system"). */
export const parseTheme = (value: string | undefined): ThemeChoice =>
  value === "dark" ? "dark" : value === "light" ? "light" : null;

/** A year. Not `httpOnly`: the toggle writes it from the client. */
export const themeCookie = (theme: Theme) =>
  `${THEME_COOKIE}=${theme}; path=/; max-age=31536000; samesite=lax`;

/**
 * What the document is actually in, read from the document itself. Client-only. Mirrors the selectors the palette
 * uses, so a change to one is a change to both.
 */
export function resolvedTheme(root: HTMLElement): Theme {
  if (root.classList.contains("dark")) return "dark";
  if (root.classList.contains("light")) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
