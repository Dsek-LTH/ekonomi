// Which cost centres a ledger request is about, as a query reads it and as the
// database is asked it.
//
// The report, the charts and the drill-down all take the same filter, and each
// used to spell it on its own for one code. With several codes allowed, the
// one rule they all have to agree on is what "no cost centre" means: a null
// code and an empty one are the same bucket (see `movements` in report.ts), so
// asking for it has to match both, or the drill-down would show a subset of
// the row it was opened from.

/** The "no cost centre" bucket's key, in the query and in the report. */
export const NO_CC = "";

/**
 * Every row that carries a cost centre, whichever it is: the other half of
 * NO_CC. Not a code anybody can be given, since codes are letters and digits.
 */
export const ANY_CC = "*";

/**
 * The cost centres a query names, from repeated `costCenter` params.
 *
 *   absent              every cost centre (undefined)
 *   `costCenter=`       the rows carrying none
 *   `costCenter=*`      the rows carrying any
 *   `costCenter=A&...`  those codes, and either bucket too if named
 *
 * Undefined rather than an empty list for "every", so a caller cannot mistake
 * "no filter" for "a filter that matches nothing".
 */
export function parseCostCenters(params: URLSearchParams): string[] | undefined {
  const codes = params.getAll("costCenter");
  return codes.length === 0 ? undefined : [...new Set(codes)];
}

// The shape of the fragment, written out rather than imported from Prisma:
// this module stays pure (see boundary.test.ts), and a mixed array left to
// inference widens to `unknown[]`, which Prisma rightly refuses.
type CodeIs = { costCenterCode: string | null };
type CodeIsSome = { AND: { costCenterCode: { not: string | null } }[] };

/** The same filter as a Prisma `where` fragment over `costCenterCode`. */
export function costCenterWhere(codes: string[] | undefined): { OR?: (CodeIs | CodeIsSome)[] } {
  if (codes === undefined) return {};
  return {
    OR: codes.flatMap((code): (CodeIs | CodeIsSome)[] =>
      code === NO_CC
        ? [{ costCenterCode: null }, { costCenterCode: NO_CC }]
        : code === ANY_CC
          ? [{ AND: [{ costCenterCode: { not: null } }, { costCenterCode: { not: NO_CC } }] }]
          : [{ costCenterCode: code }],
    ),
  };
}

/**
 * The same filter as a test on one bucket key, for the places that filter
 * what they have already loaded (a report cell, a budget line). The key is the
 * code, or NO_CC for none. Undefined codes match everything.
 */
export function costCenterMatcher(codes: string[] | undefined): (cc: string) => boolean {
  if (codes === undefined) return () => true;
  const wanted = new Set(codes);
  const any = wanted.has(ANY_CC);
  return (cc) => wanted.has(cc) || (any && cc !== NO_CC);
}
