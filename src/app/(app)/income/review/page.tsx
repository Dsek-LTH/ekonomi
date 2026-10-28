import { getIncomeReviewQueue } from "@/lib/data/income";
import { redirect } from "next/navigation";

import { canBookkeep, canViewBookkeeping } from "@/lib/domain/permissions";
import { intaktConfigured } from "@/lib/income/client";
import { requirePage } from "@/lib/server/current-user";

import IncomeReviewClient from "../review-client";
import { loadReviewContext } from "../review-context";

export default async function IncomeReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ report?: string }>;
}) {
  // The section's takings, day by day. The nav only offers this to bookkeeping;
  // this is what keeps the route from being reachable by URL regardless.
  //
  // The workbench where days are booked, entered from the Intäkter list's
  // "Granska och bokför". It is the workers'. A reader (a revisor) is sent to
  // the list, which is where there is anything to read.
  const user = await requirePage(canViewBookkeeping);
  if (!canBookkeep(user.capabilities)) redirect("/income");

  const queue = await getIncomeReviewQueue();
  const context = await loadReviewContext(queue.reports);

  // `?report=` opens the queue on one day rather than on its first. What
  // reopening a booked day uses: the day goes back into the queue, and this is
  // what makes "back into the queue" land on it instead of near it.
  const { report } = await searchParams;

  // Running without the intakt service is a supported way to run, the same as
  // running without Fortnox, so the page loads and says so rather than
  // failing. Checked here because the environment is the server's to read.
  return (
    <IncomeReviewClient
      queue={queue}
      {...context}
      serviceConfigured={intaktConfigured()}
      initialReportId={report}
    />
  );
}
