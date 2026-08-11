// Make a report for a day by hand.
//
// The collection route, beside the [id] ones that work on a day that already
// exists. Everything else in the queue arrives through ./batches — a fetch of
// what was actually sold — and this is the one thing a fetch cannot produce:
// a report for a verksamhet whose sales all went somewhere else, so the routing
// never saw them and made no report for them. See lib/income/draft.ts.
import { NextResponse } from "next/server";

import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { CreateIncomeReport } from "@/lib/api/schemas/income";
import { canAccessBookkeeping } from "@/lib/domain/permissions";
import { createDraftReport } from "@/lib/income/draft";

export async function POST(req: Request) {
  // The same gate the review screen and the move route are behind: this is
  // bookkeeping arranging its own working set before anything is booked.
  const g = await gate(canAccessBookkeeping, "auth.denied");
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, CreateIncomeReport);
  if (!parsed.ok) return parsed.res;

  const result = await createDraftReport(parsed.data);
  if (!result.ok) {
    // A day already booked over there is a state someone can reasonably ask for
    // and be told about; the other two say the app is not set up for this yet.
    const status = result.reason === "moveDestinationBooked" ? 409 : 422;
    return fail(status, `income.${result.reason}`);
  }

  // 200 rather than 201 when the verksamhet already had a draft for the day:
  // nothing was made, and the caller is being handed the report that was
  // already there — which is what `created` says.
  return NextResponse.json(result, { status: result.created ? 201 : 200 });
}
