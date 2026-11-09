// Correct where a fetched day's sold lines book: verksamhet, account, cost
// centre. Refused once the day is booked. See lib/income/lines.ts.
import { NextResponse } from "next/server";

import { gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { UpdateIncomeLines } from "@/lib/api/schemas/income";
import { canBookkeep } from "@/lib/domain/permissions";
import { updateIncomeLines } from "@/lib/income/lines";
import { lineFailure } from "../line-failure";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const g = await gate(canBookkeep, "auth.denied");
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, UpdateIncomeLines);
  if (!parsed.ok) return parsed.res;

  const result = await updateIncomeLines(id, parsed.data.lines);
  if (!result.ok) return lineFailure(result);

  return NextResponse.json(result);
}
