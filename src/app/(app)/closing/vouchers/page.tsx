import { requirePage } from "@/lib/server/current-user";
import { canViewBookkeeping } from "@/lib/domain/permissions";
import { reviewPassFor } from "@/lib/closing/review";
import { getClosingVoucherPage } from "@/lib/data/closing";
import { parseListQuery, type SearchParams } from "@/lib/data/list-query";
import ClosingVouchersClient from "./vouchers-client";
import { NoClosingYear, getOpenClosingYear } from "../year";
import { titled } from "@/lib/server/page-title";

export const generateMetadata = titled("closingVouchers");

// Every voucher in one financial year (Fortnox's financial-year id), with its underlag and review state.
export default async function ClosingVouchersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requirePage(canViewBookkeeping);
  const year = await getOpenClosingYear();
  if (!year) return <NoClosingYear />;

  // The review filter asks about the viewer's own pass; someone in neither (the chair) sees what the revisorer have done.
  const ownPass = reviewPassFor(user.capabilities);
  const filterPass = ownPass ?? "AUDITOR";

  const query = parseListQuery(await searchParams);
  const { page, counts, progress } = await getClosingVoucherPage(year, query, filterPass);
  return (
    <ClosingVouchersClient
      year={year}
      page={page}
      counts={counts}
      progress={progress}
      filterPass={filterPass}
    />
  );
}
