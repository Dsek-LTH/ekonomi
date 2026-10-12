// "Why that could not be undone", as an HTTP answer. Shared by the three
// routes in lib/income/lifecycle.ts: unexport, reopen and delete refuse for
// overlapping reasons and should say so in the same words.
import { fail } from "@/lib/api/guard";
import type { LifecycleFailure } from "@/lib/income/lifecycle";

export function lifecycleFailure(failure: LifecycleFailure) {
  switch (failure.reason) {
    case "reportNotFound":
      return fail(404, "income.reportNotFound");
    case "unexportOnlyExported":
      return fail(409, "income.unexportOnlyExported", {
        values: { status: { key: `income.status.${failure.status}` } },
      });
    case "reopenOnlyBooked":
      return fail(409, "income.reopenOnlyBooked", {
        values: { status: { key: `income.status.${failure.status}` } },
      });
    case "deleteExportedFirst":
      return fail(409, "income.deleteExportedFirst");
  }
}
