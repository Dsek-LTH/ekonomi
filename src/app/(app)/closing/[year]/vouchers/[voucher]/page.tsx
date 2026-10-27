import { notFound } from "next/navigation";
import { requirePage } from "@/lib/server/current-user";
import { canViewBookkeeping } from "@/lib/domain/permissions";
import { parseVoucherKey } from "@/lib/closing/evidence";
import { reviewPassFor } from "@/lib/closing/review";
import { getClosingVoucher, getClosingYear } from "@/lib/data/closing";
import ClosingVoucherClient from "./voucher-client";

// One voucher as the ledger has it, what the app holds behind it, and its
// review. Keyed on series and number ("A-12") rather than the row's id, which a
// sync replaces.
export default async function ClosingVoucherPage({
  params,
}: {
  params: Promise<{ year: string; voucher: string }>;
}) {
  const user = await requirePage(canViewBookkeeping);
  const { year: yearParam, voucher: voucherParam } = await params;

  const id = Number(yearParam);
  const ref = parseVoucherKey(decodeURIComponent(voucherParam));
  const year = Number.isInteger(id) && ref ? await getClosingYear(id) : null;
  if (!year || !ref) notFound();

  const voucher = await getClosingVoucher(year, ref);
  if (!voucher) notFound();
  return (
    <ClosingVoucherClient
      year={year}
      voucher={voucher}
      ownPass={reviewPassFor(user.capabilities)}
    />
  );
}
