// "Why that could not be undone" as an HTTP answer, shared by unexport, reopen and delete (lib/income/lifecycle.ts).
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
    case "reopenLegacy":
      return fail(409, "income.reopenLegacy");
    case "deleteExportedFirst":
      return fail(409, "income.deleteExportedFirst");
  }
}
