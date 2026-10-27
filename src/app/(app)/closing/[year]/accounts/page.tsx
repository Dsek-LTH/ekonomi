import { notFound } from "next/navigation";
import { requirePage } from "@/lib/server/current-user";
import { canBookkeep, canViewBookkeeping } from "@/lib/domain/permissions";
import { getClosingYear } from "@/lib/data/closing";
import { getBalanceAccounts } from "@/lib/data/closing-checklist";
import AccountsClient from "./accounts-client";

// The year's balance accounts, each marked as reconciled in Fortnox or not.
// The reconciliation is Fortnox's job; this is the record that it was done.
export default async function ClosingAccountsPage({
  params,
}: {
  params: Promise<{ year: string }>;
}) {
  const user = await requirePage(canViewBookkeeping);
  const id = Number((await params).year);
  const year = Number.isInteger(id) ? await getClosingYear(id) : null;
  if (!year) notFound();

  return (
    <AccountsClient
      year={year}
      accounts={await getBalanceAccounts(year)}
      canWork={canBookkeep(user.capabilities)}
    />
  );
}
