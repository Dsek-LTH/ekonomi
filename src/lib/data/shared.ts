// Conventions every module in lib/data follows.
//
// This directory is the one place the database schema meets the frontend: each
// function reads rows with Prisma and maps them into the exact shapes the
// screens already use (lib/domain/types.ts) — öre to SEK numbers, typed events to
// Swedish labels, relations to names. Nothing above this layer touches Prisma,
// and nothing in it renders.
//
// Two rules hold throughout:
//   • Amounts leave here in SEK. The database stores integer öre; `oreToSEK`
//     from lib/domain/money.ts is the only conversion.
//   • Every non-unique ordering carries a unique tiebreaker (usually `id`).
//     Without one Postgres may return tied rows in a different order per query,
//     which surfaces as a hydration mismatch when the HTML and the RSC payload
//     come from two executions.
import "server-only";

/** A date column as the `YYYY-MM-DD` string the UI types expect. */
export const isoDate = (d: Date | null | undefined) =>
  d ? d.toISOString().slice(0, 10) : "";
