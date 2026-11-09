// Conditional writes against the state a route checked. Between a route's read and write someone else can act on the
// same utlägg, so no such write is addressed by id alone: each restates the condition it was decided under (status,
// empty approval slot, version) and `applied` insists it matched. Matching nothing is a 409 and a reload, which keeps
// the attest trail from silently reattributing a signature.
import type { NextResponse } from "next/server";
import { fail } from "./guard";

export class StaleWrite extends Error {
  constructor(readonly code = "expense.changedMeanwhile") {
    super(code);
  }
}

/** Assert a conditional write matched the row it was aimed at. */
export function applied({ count }: { count: number }, code?: string): void {
  if (count === 0) throw new StaleWrite(code);
}

/** Run a write, turning a lost race into a 409 rather than a 500. */
export async function commit<T>(body: () => Promise<T>): Promise<T | NextResponse> {
  try {
    return await body();
  } catch (err) {
    if (err instanceof StaleWrite) return fail(409, err.code);
    throw err;
  }
}
