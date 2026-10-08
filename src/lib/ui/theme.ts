// The theme, as a cookie rather than localStorage.
//
// This used to live in localStorage, which the server cannot see, so the first
// paint was always the light default and a blocking inline <script> in
// app/layout.tsx had to reach into `document.documentElement` before the parser
// got to <body> to correct it. That script was the whole cost of storing the
// preference somewhere the request doesn't carry.
//
// A cookie rides along with the request, so the server renders <html class="dark">
// itself and there is nothing to correct: no inline script, no flash, and no
// window where the DOM and React disagree about the class. It is what the
// language, the nav pin and the receipt width already do here, and for the same
// reason, see the cookie reads in app/(app)/layout.tsx.
//
// No directive: this is imported from both a client component (the toggle that
// writes it) and server components (the layouts that read it), so it must stay
// free of `next/headers` and of "use client" alike.
export const THEME_COOKIE = "theme";

export type Theme = "light" | "dark";

/**
 * What the reader has said, which is a third thing as well as the two themes.
 *
 * `null` is "has not said", and it is not a synonym for light. The app used to
 * treat it as one, and the cost was that somebody arriving on a phone in dark
 * mode got a full white page and had to go and find the toggle to ask for the
 * thing their machine had already asked for on their behalf. Now the class is
 * simply absent and `prefers-color-scheme` decides, which the palette in
 * globals.css answers in CSS, so it still costs no script and no flash.
 *
 * The distinction has to survive into the markup, which is why an explicit
 * light is a `light` class rather than the absence of a `dark` one: on a
 * machine set to dark, "I have chosen light" and "I have not chosen" are two
 * different documents and only one of them may follow the OS.
 */
type ThemeChoice = Theme | null;

/**
 * Read a stored preference. Anything that is neither theme is "has not said",
 * which also absorbs the "system" this used to store without a migration: it
 * was already the value meaning defer to the OS, and now it does.
 */
export const parseTheme = (value: string | undefined): ThemeChoice =>
  value === "dark" ? "dark" : value === "light" ? "light" : null;

/** A year, matching the other preference cookies. Not `httpOnly`: the toggle
 *  writes it from the client, and it is a colour scheme, not a credential. */
export const themeCookie = (theme: Theme) =>
  `${THEME_COOKIE}=${theme}; path=/; max-age=31536000; samesite=lax`;

/**
 * What the document is actually in, read from the document itself.
 *
 * Client-only, and it exists because the toggle has to flip away from what the
 * reader is looking at, which on a first visit is whatever the OS said rather
 * than anything in the cookie. Mirrors the selectors the palette uses, so a
 * change to one is a change to both.
 */
export function resolvedTheme(root: HTMLElement): Theme {
  if (root.classList.contains("dark")) return "dark";
  if (root.classList.contains("light")) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
