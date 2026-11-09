// Which cost centres a ledger request is about. A null code and an empty one are the same bucket (see
// `movements` in report.ts), so asking for "none" must match both.

/** The "no cost centre" bucket's key, in the query and in the report. */
export const NO_CC = "";

/** Every row that carries a cost centre: the other half of NO_CC. Not a code anybody can be given. */
export const ANY_CC = "*";

/**
 * The cost centres a query names, from repeated `costCenter` params.
 *
 *   absent              every cost centre (undefined)
 *   `costCenter=`       the rows carrying none
 *   `costCenter=*`      the rows carrying any
 *   `costCenter=A&...`  those codes, and either bucket too if named
 *
 * Undefined (not an empty list) for "every", so "no filter" is not mistaken for "matches nothing".
 */
export function parseCostCenters(params: URLSearchParams): string[] | undefined {
  const codes = params.getAll("costCenter");
  return codes.length === 0 ? undefined : [...new Set(codes)];
}

// Written out rather than imported from Prisma: this module stays pure (boundary.test.ts).
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
          ? [
              {
                AND: [{ costCenterCode: { not: null } }, { costCenterCode: { not: NO_CC } }],
              },
            ]
          : [{ costCenterCode: code }],
    ),
  };
}

/** The same filter as a test on one bucket key (the code, or NO_CC). Undefined codes match everything. */
export function costCenterMatcher(codes: string[] | undefined): (cc: string) => boolean {
  if (codes === undefined) return () => true;
  const wanted = new Set(codes);
  const any = wanted.has(ANY_CC);
  return (cc) => wanted.has(cc) || (any && cc !== NO_CC);
}
