// Re-account a fetched day's sold lines, where they are.
//
// The sibling of ./move: that one changes which verksamhet's report a line
// belongs to, this one changes which revenue account it books to. Both are
// corrections to routing, both are refused once the day is booked, and both are
// lib/income/lines.ts.
import { NextResponse } from "next/server";

import { gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { UpdateIncomeLines } from "@/lib/api/schemas/income";
import { canAccessBookkeeping } from "@/lib/domain/permissions";
import { setLineAccounts } from "@/lib/income/lines";
import { lineFailure } from "../line-failure";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const g = await gate(canAccessBookkeeping, "auth.denied");
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, UpdateIncomeLines);
  if (!parsed.ok) return parsed.res;

  const result = await setLineAccounts(id, parsed.data.lines);
  if (!result.ok) return lineFailure(result);

  return NextResponse.json(result);
}
