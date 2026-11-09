// Correct where a fetched day's sold lines book: verksamhet, account, cost
// centre. Refused once the day is booked. See lib/income/lines.ts.
import { NextResponse } from "next/server";

import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { UpdateIncomeLines } from "@/lib/api/schemas/income";
import { canBookkeep } from "@/lib/domain/permissions";
import { updateIncomeLines } from "@/lib/income/lines";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const g = await gate(canBookkeep, "auth.denied");
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, UpdateIncomeLines);
  if (!parsed.ok) return parsed.res;

  const result = await updateIncomeLines(id, parsed.data.lines);
  if (!result.ok) {
    switch (result.reason) {
      case "reportNotFound":
        return fail(404, "income.reportNotFound");
      case "editOnlyBeforeBooking":
        return fail(409, "income.editOnlyBeforeBooking", {
          values: { status: { key: `income.status.${result.status}` } },
        });
      case "unknownAccount":
        return fail(422, "income.unknownAccount", { values: { account: result.account } });
      default:
        return fail(422, `income.${result.reason}`);
    }
  }

  return NextResponse.json(result);
}
