// Put a booked day back into editing: BOOKED -> DRAFT, verifikation deleted. It rejoins the review
// queue as an ordinary draft (the next fetch clears it).
import { NextResponse } from "next/server";

import { gate } from "@/lib/api/guard";
import { canUnexport } from "@/lib/domain/permissions";
import { reopenIncomeReport } from "@/lib/income/lifecycle";
import { lifecycleFailure } from "../lifecycle-failure";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  // The same gate as undoing an export, and it cannot be looser: it destroys a verifikation.
  const g = await gate(canUnexport, "income.noUnexportAccess");
  if (!g.ok) return g.res;

  const result = await reopenIncomeReport(id);
  if (!result.ok) return lifecycleFailure(result);

  return NextResponse.json({ id, status: "DRAFT" });
}
