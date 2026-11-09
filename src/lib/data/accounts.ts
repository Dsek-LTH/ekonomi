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

// Inactive accounts sort last but are kept: a budget or exported verification may reference one.
async function loadAccounts(where: Prisma.AccountWhereInput): Promise<AccountRecord[]> {
  const accounts = await prisma.account.findMany({
    where,
    orderBy: [{ active: "desc" }, { number: "asc" }],
  });
  return accounts.map(toAccount);
}

export function getAccounts(): Promise<AccountRecord[]> {
  return loadAccounts({});
}

// `keep` forces numbers in even when retired, so vouchers or settings still pointing at one stay valid.
export function getActiveAccounts(keep: readonly (string | null)[] = []): Promise<AccountRecord[]> {
  const numbers = [...new Set(keep.filter((n): n is string => Boolean(n)))];
  return loadAccounts(
    numbers.length ? { OR: [{ active: true }, { number: { in: numbers } }] } : { active: true },
  );
}

// No defaults: see lib/server/bookkeeping-settings.ts.
export async function getBookkeepingSettings(): Promise<BookkeepingSettings> {
  const row = await loadBookkeepingSettings();
  return {
    bankAccount: row.bankAccount,
    memberDebtAccount: row.memberDebtAccount,
  };
}
