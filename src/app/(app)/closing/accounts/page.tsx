import { requirePage } from "@/lib/server/current-user";
import { canBookkeep, canViewBookkeeping } from "@/lib/domain/permissions";
import { getBalanceAccounts } from "@/lib/data/closing-checklist";
import AccountsClient from "./accounts-client";
import { NoClosingYear, getOpenClosingYear } from "../year";
import { titled } from "@/lib/server/page-title";

export const generateMetadata = titled("closingAccounts");

// The year's balance accounts, each marked reconciled in Fortnox or not (the record that it was done).
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
