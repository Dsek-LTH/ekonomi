import { notFound } from "next/navigation";

import { getIncomeReports } from "@/lib/data/income";
import type { SearchParams } from "@/lib/data/list-query";
import {
  canAccessSettings,
  canBookkeep,
  canReviewOwnBooking,
  canUnexport,
  canViewBookkeeping,
} from "@/lib/domain/permissions";
import { incomeSetupSteps } from "@/lib/income/setup";
import { isIncomeSourceSlug } from "@/lib/income/source-slug";
import { requirePage } from "@/lib/server/current-user";
import { getFiscalYear } from "@/lib/server/fiscal-year";
import { titled } from "@/lib/server/page-title";

import IncomeClient from "../income-client";
import { loadReviewContext } from "../review-context";
import { INCOME_TABS, incomeDefaultTab, type IncomeTab } from "../tabs";

export const generateMetadata = titled("income");

export default async function IncomeListPage({
  params,
  searchParams,
}: {
  params: Promise<{ source: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { source } = await params;
  if (!isIncomeSourceSlug(source)) notFound();

  const user = await requirePage(canViewBookkeeping);
  const query = await searchParams;
  const books = canBookkeep(user.capabilities);
  const tab: IncomeTab = INCOME_TABS.find((t) => t === query.tab) ?? incomeDefaultTab(books);

  const [reports, fiscal, setup] = await Promise.all([
    getIncomeReports(source),
    getFiscalYear(),
    books ? incomeSetupSteps() : [],
  ]);
  // The settings, chart and cost centres the Behöver dig column judges a draft by (same as the day page).
  const context = await loadReviewContext(reports.filter((r) => r.status === "DRAFT"));

  return (
    <IncomeClient
      slug={source}
      reports={reports}
      tab={tab}
      defaultTab={incomeDefaultTab(books)}
      canBook={books}
      canManage={canUnexport(user.capabilities)}
      viewerId={user.id}
      exemptOwn={canReviewOwnBooking(user.capabilities)}
      settings={context.settings}
      accounts={context.accounts}
      costCenters={context.costCenters}
      projects={context.projects}
      fiscal={fiscal}
      setup={setup}
      canSetUp={canAccessSettings(user.capabilities)}
    />
  );
}
