import "server-only";

import { dueDateFor, type CheckResult } from "@/lib/closing/checklist";
import { getClosingProgress, type ClosingYear } from "@/lib/data/closing";
import { oreToSEK } from "@/lib/domain/money";
import type { ClosingCheck, Role } from "@/lib/domain/types";
import { prisma } from "@/lib/server/db";
import { isoDay } from "@/lib/domain/date";

export interface TemplateItem {
  id: string;
  title: string;
  howTo: string;
  ownerRole: Role | null;
  dueOffsetDays: number | null;
  check: ClosingCheck | null;
  sortOrder: number;
  active: boolean;
}

export interface ChecklistEntry {
  id: string;
  title: string;
  howTo: string;
  ownerRole: Role | null;
  dueDate: string | null;
  checkKey: ClosingCheck | null;
  check: CheckResult | null;
  doneAt: string | null;
  doneBy: string | null;
  note: string;
  noteToNextYear: string;
  fromLastYear: string | null;
}

export interface BalanceAccount {
  account: string;
  name: string;
  /** SEK, positive is debit. */
  opening: number;
  closing: number;
  reconciled: { at: string; by: string | null; note: string } | null;
  accountNote: string;
}

const range = (year: ClosingYear) => ({
  gte: new Date(`${year.fromDate}T00:00:00.000Z`),
  lte: new Date(`${year.toDate}T00:00:00.000Z`),
});

// BAS classes 1 and 2; compared as strings (four-digit numbers).
const isBalanceAccount = (account: string) => account < "3000";

/** The template, in order. Retired items too, for the editor; the rest skip them. */
export async function getTemplate(): Promise<TemplateItem[]> {
  return prisma.checklistTemplateItem.findMany({
    orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
    select: {
      id: true,
      title: true,
      howTo: true,
      ownerRole: true,
      dueOffsetDays: true,
      check: true,
      sortOrder: true,
      active: true,
    },
  });
}

/** Class 1 and 2 accounts with a ledger balance, and whether each is marked reconciled. Accounts that opened and closed at nothing are left out. */
export async function getBalanceAccounts(year: ClosingYear): Promise<BalanceAccount[]> {
  const [balances, marks, notes] = await Promise.all([
    prisma.ledgerAccountBalance.findMany({
      where: { financialYear: year.id, costCenterCode: "" },
      orderBy: { account: "asc" },
    }),
    prisma.accountReconciliation.findMany({
      where: { financialYear: year.id },
      include: { reconciledBy: { select: { name: true } } },
    }),
    prisma.accountNote.findMany(),
  ]);
  const markOf = new Map(marks.map((m) => [m.account, m]));
  const noteOf = new Map(notes.map((n) => [n.account, n.body]));

  return balances
    .filter((b) => isBalanceAccount(b.account) && (b.opening !== 0 || b.closing !== 0))
    .map((b) => {
      const mark = markOf.get(b.account);
      return {
        account: b.account,
        name: b.accountName,
        opening: oreToSEK(b.opening),
        closing: oreToSEK(b.closing),
        reconciled: mark
          ? {
              at: mark.reconciledAt.toISOString(),
              by: mark.reconciledBy?.name ?? null,
              note: mark.note,
            }
          : null,
        accountNote: noteOf.get(b.account) ?? "",
      };
    });
}

async function runChecks(
  year: ClosingYear,
  keys: ReadonlySet<ClosingCheck>,
): Promise<Map<ClosingCheck, CheckResult>> {
  const during = range(year);
  const results = new Map<ClosingCheck, CheckResult>();
  const needsProgress = keys.has("TREASURY_REVIEWED") || keys.has("AUDITORS_REVIEWED");

  const [progress] = await Promise.all([
    needsProgress ? getClosingProgress(year) : null,
    ...[...keys].map(async (key) => {
      switch (key) {
        case "EXPENSES_EXPORTED": {
          // Drafts are not a claim on the section until sent in.
          const remaining = await prisma.expense.count({
            where: {
              purchaseDate: during,
              status: {
                in: ["PENDING_APPROVAL", "CHANGES_REQUESTED", "APPROVED", "BOOKED"],
              },
            },
          });
          results.set(key, { remaining, href: "/expenses?scope=all" });
          break;
        }
        case "CARD_PURCHASES_ACCOUNTED": {
          const remaining = await prisma.bankTransaction.count({
            where: {
              transactionDate: during,
              amount: { lt: 0 },
              matchedExpense: { is: null },
            },
          });
          results.set(key, { remaining, href: "/bank?scope=all" });
          break;
        }
        case "INCOME_EXPORTED": {
          const remaining = await prisma.incomeReport.count({
            where: { date: during, status: { not: "EXPORTED" } },
          });
          results.set(key, { remaining, href: "/income/zettle?tab=all" });
          break;
        }
        case "STOCKTAKE_AT_YEAR_END": {
          // Within two weeks of year end either way (nobody counts the shelf on New Year's Eve).
          const end = new Date(`${year.toDate}T00:00:00.000Z`);
          const days = (n: number) => new Date(end.getTime() + n * 86_400_000);
          const counts = await prisma.stockEntry.count({
            where: { kind: "COUNT", occurredAt: { gte: days(-14), lte: days(14) } },
          });
          results.set(key, { remaining: counts > 0 ? 0 : 1, href: "/stock" });
          break;
        }
        case "LEDGER_SYNCED": {
          // Synced after the last export; hand-booked changes in Fortnox afterwards are invisible to the app.
          const last = await prisma.verification.aggregate({
            _max: { exportedAt: true },
          });
          const exportedAt = last._max.exportedAt;
          const synced =
            year.lastSyncAt !== null &&
            (!exportedAt || exportedAt.toISOString() <= year.lastSyncAt);
          results.set(key, { remaining: synced ? 0 : 1, href: "/admin/fortnox" });
          break;
        }
        case "BALANCES_RECONCILED": {
          const accounts = await getBalanceAccounts(year);
          results.set(key, {
            remaining: accounts.filter((a) => !a.reconciled).length,
            href: "/closing/accounts",
          });
          break;
        }
        case "TREASURY_REVIEWED":
        case "AUDITORS_REVIEWED":
          break; // from the progress, below
      }
    }),
  ]);

  if (progress) {
    const href = "/closing/vouchers";
    if (keys.has("TREASURY_REVIEWED")) {
      results.set("TREASURY_REVIEWED", {
        remaining: progress.total - progress.settled.PREPARER,
        href,
      });
    }
    if (keys.has("AUDITORS_REVIEWED")) {
      results.set("AUDITORS_REVIEWED", {
        remaining: progress.total - progress.settled.AUDITOR,
        href,
      });
    }
  }
  return results;
}

async function previousYearId(year: ClosingYear): Promise<number | null> {
  const prev = await prisma.fortnoxFinancialYear.findFirst({
    where: { toDate: { lt: new Date(`${year.fromDate}T00:00:00.000Z`) } },
    orderBy: { toDate: "desc" },
    select: { id: true },
  });
  return prev?.id ?? null;
}

/** The year's checklist, or null when not started. Not copied automatically, so the copy comes from the template as it stood when the skattmästare chose to start. */
export async function getChecklist(year: ClosingYear): Promise<ChecklistEntry[] | null> {
  const items = await prisma.checklistItem.findMany({
    where: { financialYear: year.id },
    orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
    include: { doneBy: { select: { name: true } } },
  });
  if (items.length === 0) return null;

  const prevId = await previousYearId(year);
  const templateIds = items.flatMap((i) => (i.templateId ? [i.templateId] : []));
  const [checks, lastYear] = await Promise.all([
    runChecks(year, new Set(items.flatMap((i) => (i.check ? [i.check] : [])))),
    prevId === null || templateIds.length === 0
      ? []
      : prisma.checklistItem.findMany({
          where: {
            financialYear: prevId,
            templateId: { in: templateIds },
            noteToNextYear: { not: "" },
          },
          select: { templateId: true, noteToNextYear: true },
        }),
  ]);
  const fromLastYear = new Map(lastYear.map((i) => [i.templateId, i.noteToNextYear]));

  return items.map((i) => ({
    id: i.id,
    title: i.title,
    howTo: i.howTo,
    ownerRole: i.ownerRole,
    dueDate: i.dueDate ? isoDay(i.dueDate) : null,
    checkKey: i.check,
    check: i.check ? (checks.get(i.check) ?? null) : null,
    doneAt: i.doneAt?.toISOString() ?? null,
    doneBy: i.doneBy?.name ?? null,
    note: i.note,
    noteToNextYear: i.noteToNextYear,
    fromLastYear: (i.templateId && fromLastYear.get(i.templateId)) || null,
  }));
}

/** Copy the active template into a year. Returns false if it already had one. */
export async function startChecklist(year: ClosingYear): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    // Lock: two simultaneous Starta presses would both copy the template.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('closing-checklist'), ${year.id}::int)`;
    const existing = await tx.checklistItem.count({ where: { financialYear: year.id } });
    if (existing > 0) return false;
    const template = await tx.checklistTemplateItem.findMany({ where: { active: true } });
    await tx.checklistItem.createMany({
      data: template.map((t) => {
        const due = dueDateFor(year.toDate, t.dueOffsetDays);
        return {
          financialYear: year.id,
          templateId: t.id,
          title: t.title,
          howTo: t.howTo,
          ownerRole: t.ownerRole,
          dueDate: due ? new Date(`${due}T00:00:00.000Z`) : null,
          check: t.check,
          sortOrder: t.sortOrder,
        };
      }),
    });
    return true;
  });
}
