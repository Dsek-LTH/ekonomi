import { notFound } from "next/navigation";

import { getIncomeBacklog, getIncomePage, hasIncomeReports } from "@/lib/data/income";
import { parseListQuery, type SearchParams } from "@/lib/data/list-query";
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
import { fiscalYearWhere, getFiscalYear } from "@/lib/server/fiscal-year";
import { titled } from "@/lib/server/page-title";

import IncomeClient from "../income-client";
import { loadReviewContext } from "../review-context";
import { incomeDefaultTab } from "../tabs";

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
  const defaultTab = incomeDefaultTab(books);
  const list = parseListQuery(query, { defaultTab });

  // The räkenskapsår narrows every tab, by the day of the takings.
  const fiscal = await getFiscalYear();
  const [page, backlog, any, setup] = await Promise.all([
    getIncomePage(source, list, { during: fiscal ? fiscalYearWhere(fiscal) : undefined }),
    books ? getIncomeBacklog(source) : [],
    hasIncomeReports(source),
    books ? incomeSetupSteps() : [],
  ]);
  // The settings, chart and cost centres the Behöver dig column and the bulk buttons judge a draft by (same as the day page).
  const context = await loadReviewContext(
    [...page.rows, ...backlog].filter((r) => r.status === "DRAFT"),
  );

  return (
    <IncomeClient
      slug={source}
      page={page}
      backlog={backlog}
      empty={!any}
      defaultTab={defaultTab}
      canBook={books}
      canManage={canUnexport(user.capabilities)}
      viewerId={user.id}
      exemptOwn={canReviewOwnBooking(user.capabilities)}
      settings={context.settings}
      accounts={context.accounts}
      costCenters={context.costCenters}
      projects={context.projects}
      setup={setup}
      canSetUp={canAccessSettings(user.capabilities)}
    />
  );
}
