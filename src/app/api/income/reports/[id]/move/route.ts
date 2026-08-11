// Move sold lines onto another verksamhet's report for the same day.
//
// The correction for a product rung up without its prefix: the routing sent it
// to the fallback, and this puts it where the money actually belongs. The whole
// operation is lib/income/lines.ts — this is the gate and the body. Its sibling
// ../lines re-accounts them without moving them.
import { NextResponse } from "next/server";

import { gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { MoveIncomeLines } from "@/lib/api/schemas/income";
import { canAccessBookkeeping } from "@/lib/domain/permissions";
import { moveIncomeLines } from "@/lib/income/lines";
import { lineFailure } from "../line-failure";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  // The same gate the review screen is behind: this is bookkeeping correcting
  // its own working set before anything is booked.
  const g = await gate(canAccessBookkeeping, "auth.denied");
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, MoveIncomeLines);
  if (!parsed.ok) return parsed.res;

  const result = await moveIncomeLines(id, parsed.data.toResultUnitId, parsed.data.lines);
  if (!result.ok) return lineFailure(result);

  return NextResponse.json(result);
}
