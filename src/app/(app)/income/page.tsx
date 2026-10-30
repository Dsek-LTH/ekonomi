import { getBookedIncome, getIncomeReviewQueue } from "@/lib/data/income";
import { canAccessSettings, canBookkeep, canViewBookkeeping, canUnexport } from "@/lib/domain/permissions";
import type { SearchParams } from "@/lib/data/list-query";
import { incomeSetupSteps } from "@/lib/income/setup";
import { requirePage } from "@/lib/server/current-user";
import { getFiscalYear } from "@/lib/server/fiscal-year";
import IncomeClient from "./income-client";
import { INCOME_TABS, incomeDefaultTab, type IncomeTab } from "./tabs";

// Intäkter: every day of takings, waiting or booked, with the stage as a tab.
// See docs/navigation.md.
//
// It used to be two pages behind a switch: the review queue here and the
// booked days at /income/booked. Stage is a tab on every other list, so it is
// one here too, and the queue is the workbench you go into from it
// (/income/review), the way the utlägg review is.
export default async function IncomePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requirePage(canViewBookkeeping);
  const params = await searchParams;
  const books = canBookkeep(user.capabilities);
  const tab: IncomeTab = INCOME_TABS.find((t) => t === params.tab) ?? incomeDefaultTab(books);
  // Only for whoever fetches and books: a reader has nothing to set up.
  const [queue, booked, fiscal, setup] = await Promise.all([
    getIncomeReviewQueue(),
    getBookedIncome(),
    getFiscalYear(),
    books ? incomeSetupSteps() : [],
  ]);
  // Undoing any of this (unexporting, unbooking, deleting) is the treasury's
  // to do, not everyone with bookkeeping access. Decided here, where the roles
  // are, and enforced again by every route behind the buttons.
  return (
    <IncomeClient
      reports={[...queue.reports, ...booked]}
      tab={tab}
      defaultTab={incomeDefaultTab(books)}
      canBook={books}
      canManage={canUnexport(user.capabilities)}
      fiscal={fiscal}
      setup={setup}
      canSetUp={canAccessSettings(user.capabilities)}
    />
  );
}
