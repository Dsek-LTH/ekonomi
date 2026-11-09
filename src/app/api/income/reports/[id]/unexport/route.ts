// Mark an exported day as no longer exported: EXPORTED -> BOOKED. Fortnox keeps the voucher, so the
// treasury roles (not bookkeeping) do this and reverse it there.
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
