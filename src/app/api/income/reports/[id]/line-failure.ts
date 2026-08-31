// One mapping from "why a line could not be corrected" to an HTTP answer,
// shared by the two routes that correct them: ./move and ./lines.
//
// Both refuse for the same reasons up to the point where a destination is
// involved, and a refusal a person can act on is worth stating the same way
// whichever of the two they asked for.
import { fail } from "@/lib/api/guard";
import type { MoveFailure } from "@/lib/income/lines";

export function lineFailure(failure: MoveFailure) {
  switch (failure.reason) {
    case "reportNotFound":
      return fail(404, "income.reportNotFound");
    case "editOnlyBeforeBooking":
      return fail(409, "income.editOnlyBeforeBooking", {
        values: { status: { key: `income.status.${failure.status}` } },
      });
    case "moveDestinationBooked":
      return fail(409, "income.moveDestinationBooked");
    case "unknownAccount":
      return fail(422, "income.unknownAccount", { values: { account: failure.account } });
    // The rest are the request contradicting itself: a fee report has no
    // verksamhet, a move to where the lines already are is not a move.
    default:
      return fail(422, `income.${failure.reason}`);
  }
}
