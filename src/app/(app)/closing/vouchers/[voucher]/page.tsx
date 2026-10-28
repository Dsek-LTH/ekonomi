import { notFound } from "next/navigation";
import { requirePage } from "@/lib/server/current-user";
import { canViewBookkeeping } from "@/lib/domain/permissions";
import { parseVoucherKey } from "@/lib/closing/evidence";
import { reviewPassFor } from "@/lib/closing/review";
import { getClosingVoucher } from "@/lib/data/closing";
import ClosingVoucherClient from "./voucher-client";
import { getOpenClosingYear } from "../../year";

// One voucher as the ledger has it, what the app holds behind it, and its
// review. Keyed on series and number ("A-12") rather than the row's id, which a
// sync replaces.
export default async function ClosingVoucherPage({
  params,
}: {
  params: Promise<{ voucher: string }>;
}) {
  const user = await requirePage(canViewBookkeeping);
  const { voucher: voucherParam } = await params;

  // A voucher of the header's year. One from another year is not found here,
  // the same as any key that names no voucher.
  const ref = parseVoucherKey(decodeURIComponent(voucherParam));
  const year = ref ? await getOpenClosingYear() : null;
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
