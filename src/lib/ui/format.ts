// Formatting helpers, reused across every screen.
//
// Dates follow the reader's language; money does not. An amount here is a
// Swedish accounting figure that has to match what Fortnox prints and what the
// person beside you is reading off their own screen, so SEK stays in Swedish
// notation — "1 247,50 kr" — whichever language the interface is in. A month
// name has no such tie, and "12 juli 2026" in an English sentence is simply
// wrong, so that one is localised.

// Two-letter initials from a person's name (first + last). Used by the avatar
// and anywhere we render a compact identity badge.
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

// The UI locale → the locale its dates are formatted in. en-GB rather than
// en-US: day-before-month, which is what everyone reading this app is used to.
const DATE_LOCALE: Record<string, string> = { sv: "sv-SE", en: "en-GB" };
const DEFAULT_LOCALE = "sv";

// Intl formatters are expensive to construct, and these run per table cell —
// build each one once and keep it, rather than on every call.
const SEK = new Intl.NumberFormat("sv-SE", {
  style: "currency",
  currency: "SEK",
  maximumFractionDigits: 2,
});

const dateCache = new Map<string, Intl.DateTimeFormat>();
const dateTimeCache = new Map<string, Intl.DateTimeFormat>();

function formatter(
  cache: Map<string, Intl.DateTimeFormat>,
  locale: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const tag = DATE_LOCALE[locale] ?? DATE_LOCALE[DEFAULT_LOCALE];
  let f = cache.get(tag);
  if (!f) {
    f = new Intl.DateTimeFormat(tag, options);
    cache.set(tag, f);
  }
  return f;
}

export function formatSEK(amount: number): string {
  return SEK.format(amount);
}

/**
 * A date as the reader reads it. `locale` is the UI language ("sv" / "en") —
 * components get it from `useFormat()`, which binds the active one; the default
 * is there for the few callers outside a React tree.
 */
export function formatDate(iso: string, locale: string = DEFAULT_LOCALE): string {
  const d = new Date(iso);
  if (!iso || isNaN(d.getTime())) return "—";
  return formatter(dateCache, locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d);
}

export function formatDateTime(iso: string, locale: string = DEFAULT_LOCALE): string {
  const d = new Date(iso);
  if (!iso || isNaN(d.getTime())) return "—";
  return formatter(dateTimeCache, locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}
