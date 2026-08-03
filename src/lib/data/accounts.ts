// The BAS chart of accounts as synced from Fortnox, and the accounts the
// booking view pre-fills from it.
import "server-only";

import { prisma } from "@/lib/server/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { AccountRecord, BookkeepingSettings } from "@/lib/domain/types";

type AccountRow = {
  number: string;
  name: string;
  active: boolean;
  sru: string | null;
  lastSyncAt: Date | null;
};

const toAccount = (a: AccountRow): AccountRecord => ({
  number: a.number,
  name: a.name,
  active: a.active,
  sru: a.sru ?? undefined,
  lastSyncAt: a.lastSyncAt?.toISOString() ?? undefined,
});

// Inactive accounts are kept (a budget or an exported verification may still
// reference one) but sort last, so pickers lead with what's current.
async function loadAccounts(where: Prisma.AccountWhereInput): Promise<AccountRecord[]> {
  const accounts = await prisma.account.findMany({
    where,
    orderBy: [{ active: "desc" }, { number: "asc" }],
  });
  return accounts.map(toAccount);
}

/** The whole synced BAS chart. */
export function getAccounts(): Promise<AccountRecord[]> {
  return loadAccounts({});
}

// Accounts a picker should offer: the active ones. `keep` forces specific BAS
// numbers in even when retired, so an existing voucher that references one (or
// a bookkeeping setting still pointing at one) stays valid and re-savable.
// Fortnox retires accounts routinely, so this is the normal case, not an edge.
export function getActiveAccounts(keep: readonly string[] = []): Promise<AccountRecord[]> {
  const numbers = [...new Set(keep.filter(Boolean))];
  return loadAccounts(
    numbers.length ? { OR: [{ active: true }, { number: { in: numbers } }] } : { active: true },
  );
}

// The accounts the booking view pre-fills. Falls back to the BAS defaults when
// the settings row is somehow missing, so booking never breaks on config.
export async function getBookkeepingSettings(): Promise<BookkeepingSettings> {
  const row = await prisma.bookkeepingSettings.findUnique({ where: { id: "singleton" } });
  return {
    bankAccount: row?.bankAccount ?? "1930",
    memberDebtAccount: row?.memberDebtAccount ?? "2890",
  };
}
