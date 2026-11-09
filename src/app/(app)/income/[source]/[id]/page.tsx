import { notFound, redirect } from "next/navigation";

import { getIncomeReport } from "@/lib/data/income";
import {
  canBookkeep,
  canReviewOwnBooking,
  canUnexport,
  canViewBookkeeping,
} from "@/lib/domain/permissions";
import { isIncomeSourceSlug, slugOf } from "@/lib/income/source-slug";
import { requirePage } from "@/lib/server/current-user";
import { titled } from "@/lib/server/page-title";

import DayClient from "../../day-client";
import { loadReviewContext } from "../../review-context";

export const generateMetadata = titled("incomeDay");

export default async function IncomeDayPage({
  params,
}: {
  params: Promise<{ source: string; id: string }>;
}) {
  const { source, id } = await params;
  if (!isIncomeSourceSlug(source)) notFound();

  const user = await requirePage(canViewBookkeeping);
  const detail = await getIncomeReport(id);
  if (!detail) notFound();
  const { report } = detail;
  // A day under the other source's path is an old link or a typo: send it to where the day lives.
  if (slugOf(report.source) !== source) redirect(`/income/${slugOf(report.source)}/${id}`);

  const context = await loadReviewContext([report]);
  const ownBooking = !canReviewOwnBooking(user.capabilities) && report.bookedBy.includes(user.id);

  return (
    <DayClient
      report={report}
      voucherRows={detail.voucher}
      settings={context.settings}
      costCenters={context.costCenters}
      accounts={context.accounts}
      projects={context.projects}
      moveTargets={context.moveTargets}
      canBook={canBookkeep(user.capabilities)}
      canManage={canUnexport(user.capabilities)}
      ownBooking={ownBooking}
      reviewerName={user.name}
    />
  );
}
