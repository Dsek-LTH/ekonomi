// Put a booked day back into editing: BOOKED → DRAFT, verifikation deleted.
//
// It rejoins the review queue as an ordinary draft, and the screen navigates
// there with the day selected. Ordinary in every sense, including that the next
// fetch clears it away with the rest of the working set — a day that has been
// unbooked has no claim on being kept, and a fetch covering it brings it back.
import { NextResponse } from "next/server";

import { gate } from "@/lib/api/guard";
import { canUnexport } from "@/lib/domain/permissions";
import { reopenIncomeReport } from "@/lib/income/lifecycle";
import { lifecycleFailure } from "../lifecycle-failure";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  // The same gate as undoing an export. Unbooking is the larger step of the
  // two — it destroys a verifikation — so it cannot be the looser one.
  const g = await gate(canUnexport, "income.noUnexportAccess");
  if (!g.ok) return g.res;

  const result = await reopenIncomeReport(id);
  if (!result.ok) return lifecycleFailure(result);

  return NextResponse.json({ id, status: "DRAFT" });
}
