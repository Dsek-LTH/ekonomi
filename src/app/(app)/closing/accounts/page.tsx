import { requirePage } from "@/lib/server/current-user";
import { canBookkeep, canViewBookkeeping } from "@/lib/domain/permissions";
import { getBalanceAccounts } from "@/lib/data/closing-checklist";
import AccountsClient from "./accounts-client";
import { NoClosingYear, getOpenClosingYear } from "../year";

// The year's balance accounts, each marked as reconciled in Fortnox or not.
// The reconciliation is Fortnox's job; this is the record that it was done.
export default async function ClosingAccountsPage() {
  const user = await requirePage(canViewBookkeeping);
  const year = await getOpenClosingYear();
  if (!year) return <NoClosingYear />;

  return (
    <AccountsClient
      year={year}
      accounts={await getBalanceAccounts(year)}
      canWork={canBookkeep(user.capabilities)}
    />
  );
}
