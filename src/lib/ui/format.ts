// Dates follow the reader's language; money does not: SEK stays in Swedish notation ("1 247,50 kr") to match Fortnox.

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

// UI locale to date locale. en-GB, not en-US: day before month.
const DATE_LOCALE: Record<string, string> = { sv: "sv-SE", en: "en-GB" };
const DEFAULT_LOCALE = "sv";

// Intl formatters are expensive and run per table cell: built once.
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

/** A date as the reader reads it. `locale` is the UI language ("sv" / "en"); components get it from `useFormat()`. */
export function formatDate(iso: string, locale: string = DEFAULT_LOCALE): string {
  const d = new Date(iso);
  if (!iso || isNaN(d.getTime())) return "-";
  return formatter(dateCache, locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d);
}

export function formatDateTime(iso: string, locale: string = DEFAULT_LOCALE): string {
  const d = new Date(iso);
  if (!iso || isNaN(d.getTime())) return "-";
  return formatter(dateTimeCache, locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

// ── Öre, and the units the cellar counts in ────────────────────────

const KR_0 = new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 0 });
const KR_2 = new Intl.NumberFormat("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const KR_0_SIGNED = new Intl.NumberFormat("sv-SE", {
  signDisplay: "exceptZero",
  maximumFractionDigits: 0,
});

/**
 * An amount in öre, as "1 247 kr". `decimals: 2` for figures checked against a document (unit cost, delivery),
 * `decimals: 0` for totals and movements. `sign` writes the plus on positive figures.
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

/** A VOLUME product movement in litres, to at most two decimals ("0,4 l"); finer than `formatLitres` since 4 cl would round to nothing. */
export const formatMovementLitres = (ml: number): string => `${LITRES_2.format(ml / 1000)} l`;

const SIGNED = new Intl.NumberFormat("sv-SE", { signDisplay: "exceptZero" });

/** A count with its direction: "+3", "−2", "0". For a column of movements. */
export const formatSigned = (n: number): string => SIGNED.format(n);

/** A plain figure with between `min` and `max` decimals ("4 213,5" km), for numbers that are neither kronor nor volume. */
const numberCache = new Map<string, Intl.NumberFormat>();

export function formatNumber(n: number, min: number, max: number): string {
  const key = `${min}-${max}`;
  let f = numberCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat("sv-SE", {
      minimumFractionDigits: min,
      maximumFractionDigits: max,
    });
    numberCache.set(key, f);
  }
  return f.format(n);
}

/** Centilitres per krona, the cellar's own value-for-money figure. */
export const formatClPerKrona = (cl: number): string => KR_2.format(cl);

/**
 * A sentence from the clauses that apply ("Updated 12 cost centres, deactivated 3."). Falsy clauses drop out, so a
 * caller passes `n && t("retired", { count: n })`; 0 is falsy on purpose.
 */
export const sentence = (...clauses: (string | number | false | null | undefined)[]): string =>
  `${clauses.filter((c) => typeof c === "string" && c).join(", ")}.`;
