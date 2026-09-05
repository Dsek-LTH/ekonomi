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

/** Light unless it says otherwise. There is no third state deferring to the OS. */
const DEFAULT_THEME: Theme = "light";

/**
 * Read a stored preference. Anything that is not exactly "dark" is the default,
 * which also absorbs the "system" this used to store without a migration: it
 * reads as light, and the next click overwrites it.
 */
export const parseTheme = (value: string | undefined): Theme =>
  value === "dark" ? "dark" : DEFAULT_THEME;

/** A year, matching the other preference cookies. Not `httpOnly`: the toggle
 *  writes it from the client, and it is a colour scheme, not a credential. */
export const themeCookie = (theme: Theme) =>
  `${THEME_COOKIE}=${theme}; path=/; max-age=31536000; samesite=lax`;
