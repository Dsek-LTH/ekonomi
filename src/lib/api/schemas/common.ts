// Pieces every request body is built from. No imports from lib/server or next/server: schemas are shared with the browser.
import { z } from "zod";

/** A string with its surrounding space removed, which is how every one is stored. */
export const Trimmed = z.string().trim();

/** A string that has to say something once trimmed. */
export const NonEmpty = Trimmed.min(1);

/** A code typed by hand: trimmed and upper-cased, the stored form (cost-centre codes, variable names, series, prefixes). */
export const UpperCode = Trimmed.transform((s) => s.toUpperCase());

/** A cuid from our own database. Only ever compared, never parsed. */
export const Id = z.string().min(1);

/** A money amount in integer öre (the columns are integers). Signed: a refund is the same claim with the sign flipped. */
export const Ore = z.int();

/** A whole calendar date, `YYYY-MM-DD`, never a partial one. */
export const IsoDate = z.iso.date();

/** A financial year. The bounds keep a typo'd `202` or `20260` out. */
export const Year = z.coerce.number().int().min(1900).max(2200);

/** A field that may be sent as `null` or `""` to clear it, and is absent when not touching it. Both clears arrive as `null`. */
export const Clearable = <T extends z.ZodType>(inner: T) =>
  z.union([inner, z.literal(""), z.null()]).transform((v) => (v === "" ? null : v));
