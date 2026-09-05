// Formatting helpers, reused across every screen.
//
// Dates follow the reader's language; money does not. An amount here is a
// Swedish accounting figure that has to match what Fortnox prints and what the
// person beside you is reading off their own screen, so SEK stays in Swedish
// notation ("1 247,50 kr") whichever language the interface is in. A month
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

// Intl formatters are expensive to construct, and these run per table cell:
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
 * A date as the reader reads it. `locale` is the UI language ("sv" / "en").
 * Components get it from `useFormat()`, which binds the active one; the default
 * is there for the few callers outside a React tree.
 */
export function formatDate(iso: string, locale: string = DEFAULT_LOCALE): string {
  const d = new Date(iso);
  if (!iso || isNaN(d.getTime())) return "–";
  return formatter(dateCache, locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d);
}

export function formatDateTime(iso: string, locale: string = DEFAULT_LOCALE): string {
  const d = new Date(iso);
  if (!iso || isNaN(d.getTime())) return "–";
  return formatter(dateTimeCache, locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

// ── Öre, and the units the cellar counts in ────────────────────────
//
// These were written out at the top of eight screens, each building a fresh
// `Intl.NumberFormat` on every call, which is the one thing the note above says
// not to do: they run per table cell. They had also drifted, which is the
// better argument: the stock list rounded to whole kronor and the product page
// to two decimals, so the same bottle's value read "1 247 kr" on one screen and
// "1 246,50 kr" on the next.

const KR_0 = new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 0 });
const KR_2 = new Intl.NumberFormat("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const KR_0_SIGNED = new Intl.NumberFormat("sv-SE", {
  signDisplay: "exceptZero",
  maximumFractionDigits: 0,
});

/**
 * An amount in öre, as "1 247 kr".
 *
 * Which precision is not a per-screen preference, and treating it as one is
 * what let the same shelf value read "1 247 kr" on the stock list and
 * "1 246,50 kr" on the product page. The rule:
 *
 *   `decimals: 2`  a figure somebody checks against a document. A unit cost, a
 *                  delivery being typed off an invoice. The öre are the point.
 *   `decimals: 0`  a total or a movement. What the shelf is worth, what a night
 *                  sold, what a row did to the value. Nobody reconciles these
 *                  to the öre and the extra digits are noise in a column.
 *
 * `sign` writes the plus on a positive figure, for a column of movements where
 * the direction is the point.
 */
export function formatOreKr(
  ore: number,
  { decimals = 0, sign = false }: { decimals?: 0 | 2; sign?: boolean } = {},
): string {
  const f = decimals === 2 ? KR_2 : sign ? KR_0_SIGNED : KR_0;
  return `${f.format(ore / 100)} kr`;
}

const LITRES = new Intl.NumberFormat("sv-SE", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** Millilitres as litres, to one decimal: the unit a shelf is counted in. */
export const formatLitres = (ml: number): string => LITRES.format(ml / 1000);

const LITRES_2 = new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 2 });

/**
 * A movement of a VOLUME product, in litres, to at most two decimals: "0,4 l".
 *
 * Litres whatever the size, unlike `formatLitres`' one decimal, because these
 * are single movements rather than a shelf total and 40 cl of an opened bottle
 * would round to "0,4" either way but 4 cl would round to nothing.
 */
export const formatMovementLitres = (ml: number): string => `${LITRES_2.format(ml / 1000)} l`;

/** Centilitres per krona, the cellar's own value-for-money figure. */
export const formatClPerKrona = (cl: number): string => KR_2.format(cl);

/**
 * A sentence from the clauses that apply: "Updated 12 cost centres,
 * deactivated 3."
 *
 * For a summary whose parts each depend on a count being non-zero. Written as
 * nested ternaries over one message key per combination before, four keys for
 * the cost-centre sync and two for the chart of accounts, which meant a fifth
 * counter would have cost eight keys and a five-deep ternary. The clauses are
 * separate keys instead, and a translator writes each one once.
 *
 * Anything falsy drops out, so a caller passes `n && t("retired", { count: n })`
 * and says nothing about a count of nothing. `0` is among the falsy values on
 * purpose: that guard is nearly always a count, and `n &&` yields the number
 * rather than `false` when it is zero.
 */
export const sentence = (
  ...clauses: (string | number | false | null | undefined)[]
): string => `${clauses.filter((c) => typeof c === "string" && c).join(", ")}.`;
