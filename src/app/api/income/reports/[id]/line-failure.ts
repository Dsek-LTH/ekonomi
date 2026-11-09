// One mapping from "why a line could not be corrected" to an HTTP answer.
import { fail } from "@/lib/api/guard";
import type { LineFailure } from "@/lib/income/lines";

export function lineFailure(failure: LineFailure) {
  switch (failure.reason) {
    case "reportNotFound":
      return fail(404, "income.reportNotFound");
    case "editOnlyBeforeBooking":
      return fail(409, "income.editOnlyBeforeBooking", {
        values: { status: { key: `income.status.${failure.status}` } },
      });
    case "unknownAccount":
      return fail(422, "income.unknownAccount", { values: { account: failure.account } });
    // The rest are the request contradicting itself: a fee report has no
    // verksamhet, a move to where the lines already are is not a move.
    default:
      return fail(422, `income.${failure.reason}`);
  }
}
