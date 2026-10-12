// The pieces every request body is built from.
//
// Nothing here imports from lib/server or next/server: a schema is shared with
// the browser, which is the point of having them (see lib/api/parse.ts). The
// route pulls the schema in and validates; the client pulls the same one in and
// gets a type that stops compiling when the two drift apart.
import { z } from "zod";

/** A string with its surrounding space removed, which is how every one is stored. */
export const Trimmed = z.string().trim();

/** A string that has to say something once trimmed. */
export const NonEmpty = Trimmed.min(1);

/**
 * A code typed by hand: trimmed and upper-cased, because that is the case they
 * are stored and compared in (cost-centre codes, variable names, voucher
 * series, result-unit prefixes).
 */
export const UpperCode = Trimmed.transform((s) => s.toUpperCase());

/** A cuid from our own database. Only ever compared, never parsed. */
export const Id = z.string().min(1);

/**
 * A money amount, in integer öre.
 *
 * Integer because öre is the resolution money is kept at and a fraction of one
 * is not a smaller amount, it is a different one, and because the columns
 * behind these are integers, so a float would reach Postgres and come back as a
 * 500 instead of a message. Signed: a refund is the same claim with the sign
 * flipped.
 */
export const Ore = z.int();

/** A whole calendar date, `YYYY-MM-DD`, never a partial one. */
export const IsoDate = z.iso.date();

/**
 * A financial year. The bounds are not a guess about how long the section will
 * exist; they are what keeps a typo'd `202` or `20260` out of a column that
 * decides which year's outcome a budget is held against.
 */
export const Year = z.coerce.number().int().min(1900).max(2200);

/**
 * A field that may be sent as `null` or `""` to clear it, and is absent when
 * the caller is not touching it. The two spellings of "clear" both arrive as
 * `null`, so a route has one case to handle rather than three.
 */
export const Clearable = <T extends z.ZodType>(inner: T) =>
  z.union([inner, z.literal(""), z.null()]).transform((v) => (v === "" ? null : v));
