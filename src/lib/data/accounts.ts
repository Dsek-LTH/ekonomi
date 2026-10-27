// The BAS chart of accounts as synced from Fortnox, and the accounts the
// booking view pre-fills from it.
import "server-only";

import { prisma } from "@/lib/server/db";
import { loadBookkeepingSettings } from "@/lib/server/bookkeeping-settings";
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
// A setting nobody has chosen yet is null, and simply keeps nothing in.
export function getActiveAccounts(
  keep: readonly (string | null)[] = [],
): Promise<AccountRecord[]> {
  const numbers = [...new Set(keep.filter((n): n is string => Boolean(n)))];
  return loadAccounts(
    numbers.length ? { OR: [{ active: true }, { number: { in: numbers } }] } : { active: true },
  );
}

// The accounts the booking view pre-fills. No defaults: see
// lib/server/bookkeeping-settings.ts.
export async function getBookkeepingSettings(): Promise<BookkeepingSettings> {
  const row = await loadBookkeepingSettings();
  return {
    bankAccount: row.bankAccount,
    memberDebtAccount: row.memberDebtAccount,
  };
}
