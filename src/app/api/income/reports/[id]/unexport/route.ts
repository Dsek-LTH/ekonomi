// Mark an exported day as no longer exported: EXPORTED → BOOKED.
//
// This app forgets the Fortnox voucher; Fortnox keeps it. Exporting again would
// therefore write a second one for the same takings, so whoever does this has
// to go and reverse the first, which is why it is behind the treasury roles
// rather than behind bookkeeping access, exactly as the utlägg version is.
import { NextResponse } from "next/server";

import { gate } from "@/lib/api/guard";
import { canUnexport } from "@/lib/domain/permissions";
import { unexportIncomeReport } from "@/lib/income/lifecycle";
import { lifecycleFailure } from "../lifecycle-failure";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const g = await gate(canUnexport, "income.noUnexportAccess");
  if (!g.ok) return g.res;

  const result = await unexportIncomeReport(id);
  if (!result.ok) return lifecycleFailure(result);

  return NextResponse.json({ id, status: "BOOKED" });
}
