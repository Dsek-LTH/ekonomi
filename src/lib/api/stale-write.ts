// ── Acting on the state you actually checked ──────────────────────
//
// A route reads an utlägg once, decides against what it read, and then writes.
// Between those two moments somebody else can act on the same utlägg, whether
// two attestants clicking at once, two bookkeepers booking the same one, or one
// person's second tab, and the write would land on a row that no longer looks
// like the one the decision was made about. Nothing failed; the numbers simply
// stopped meaning what they said. In the approve path it was worse than a lost
// update: the rows to sign were chosen by `!a.approvedById` outside the
// transaction and then written by id alone, so the second writer replaced the
// first one's signature with their own name. An attest trail that can silently
// reattribute a signature is not one.
//
// So no such write is addressed by id alone. Each one restates the condition it
// was decided under (the status it expects, the approval slot it expects to be
// empty, the version the screen was showing) and `applied` insists that it
// actually matched something. A write that matched nothing means the world
// moved underneath us, which is a 409 and a reload, not a silent success.
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
