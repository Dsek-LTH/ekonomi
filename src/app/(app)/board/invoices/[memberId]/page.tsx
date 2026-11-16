import { notFound } from "next/navigation";

import { getActiveAccounts } from "@/lib/data/accounts";
import { getBoardMembers, getBoardWithdrawals, getClosedTabs } from "@/lib/data/board";
import { getCostCenters } from "@/lib/data/cost-centers";
import { canBookkeep, canViewBookkeeping } from "@/lib/domain/permissions";
import { requirePage } from "@/lib/server/current-user";
import { previewBoardInvoices } from "@/lib/server/board-invoices";
import { getFiscalYear } from "@/lib/server/fiscal-year";
import { titled } from "@/lib/server/page-title";
import { fiscalYearLabel } from "@/lib/ui/fiscal-year";

import MemberClient from "./member-client";

export const generateMetadata = titled("boardInvoices");

// One person's tab, as the treasury sees it: the same receipt as their Mina uttag, and "Fakturera nu" for somebody
// leaving the board before the year's end.
export default async function BoardMemberPage({
  params,
}: {
  params: Promise<{ memberId: string }>;
}) {
  const user = await requirePage(canViewBookkeeping);
  const { memberId } = await params;
  const year = await getFiscalYear();
  const manage = canBookkeep(user.capabilities);
  const [members, open, closed, invoices, accounts, costCenters] = await Promise.all([
    getBoardMembers(),
    getBoardWithdrawals({ memberId, invoiced: false }),
    getClosedTabs(memberId),
    year ? previewBoardInvoices(year) : [],
    manage ? getActiveAccounts() : [],
    manage ? getCostCenters() : [],
  ]);
  const member = members.find((m) => m.id === memberId);
  if (!member) notFound();
  const preview = invoices.find(
    (i) =>
      i.memberId === memberId && (i.lines.length > 0 || i.invoices.some((v) => !v.documentNumber)),
  );

  return (
    <MemberClient
      member={member}
      open={open}
      closed={closed}
      preview={preview ?? null}
      yearLabel={year ? fiscalYearLabel(year) : null}
      canManage={manage}
      resend={{
        accountOptions: accounts.map((a) => ({
          value: a.number,
          label: `${a.number} - ${a.name}`,
          short: a.number,
        })),
        costCenterOptions: costCenters
          .filter((c) => c.active)
          .map((c) => ({ value: c.id, label: `${c.code} - ${c.name}`, short: c.code })),
      }}
    />
  );
}
