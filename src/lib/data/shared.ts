// Amounts leave this layer in SEK (the db stores öre; use `oreToSEK`).
// Every non-unique ordering needs a unique tiebreaker (usually `id`), or tied rows can differ
// between the HTML and RSC executions and cause hydration mismatches.
import "server-only";
import { isoDay } from "@/lib/domain/date";

export const isoDate = (d: Date | null | undefined) => (d ? isoDay(d) : "");
