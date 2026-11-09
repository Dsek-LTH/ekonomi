// Gate for every budget write: a locked budget rejects writes to its numbers. Comments stay open on a locked budget.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { canChangeLockedBudget, isAdmin } from "@/lib/domain/permissions";
import { fail, gate, type Gate } from "@/lib/api/guard";

type BudgetTarget =
  | { budget: string }
  | { costCenter: string } // BudgetCostCenter id (a sheet), not CostCenter
  | { account: string }
  | { lineItem: string }
  | { variable: string };

const budgetLock = { select: { lockedAt: true } } as const;

// Lock state of the budget `target` belongs to, or null if it no longer exists.
async function findLock(target: BudgetTarget): Promise<{ lockedAt: Date | null } | null> {
  if ("budget" in target) {
    return prisma.budget.findUnique({ where: { id: target.budget }, ...budgetLock });
  }
  if ("costCenter" in target) {
    const row = await prisma.budgetCostCenter.findUnique({
      where: { id: target.costCenter },
      select: { budget: budgetLock },
    });
    return row?.budget ?? null;
  }
  if ("variable" in target) {
    const row = await prisma.budgetVariable.findUnique({
      where: { id: target.variable },
      select: { budget: budgetLock },
    });
    return row?.budget ?? null;
  }
  if ("account" in target) {
    const row = await prisma.budgetAccount.findUnique({
      where: { id: target.account },
      select: { budgetCostCenter: { select: { budget: budgetLock } } },
    });
    return row?.budgetCostCenter.budget ?? null;
  }
  const row = await prisma.budgetLineItem.findUnique({
    where: { id: target.lineItem },
    select: { account: { select: { budgetCostCenter: { select: { budget: budgetLock } } } } },
  });
  return row?.account.budgetCostCenter.budget ?? null;
}

/**
 * Whether this request may write to the budget `target` belongs to.
 * Returns `{ ok }` like `gate()`, so forgetting to unwrap the verdict is a type error, not an open door.
 */
export async function allowBudgetWrite(target: BudgetTarget): Promise<Gate> {
  const g = await gate(isAdmin);
  if (!g.ok) return g;

  const lock = await findLock(target);
  if (!lock) return { ok: false, res: fail(404, "notFound") };
  if (lock.lockedAt) return { ok: false, res: fail(409, "budget.locked") };
  return g;
}

// The editorial-change door: opens only when the budget is locked. Needs the actor, since the change is signed.

/** Refuses to delete an account or sheet the editorial history names (revoked changes count), since its adjustment rows would cascade. */
export async function denyDeletingAdjusted(
  target: { account: string } | { costCenter: string },
): Promise<NextResponse | null> {
  const where =
    "account" in target
      ? { accountId: target.account }
      : { account: { budgetCostCenterId: target.costCenter } };

  const found = await prisma.budgetAdjustment.findFirst({ where, select: { id: true } });
  if (!found) return null;

  return fail(409, "account" in target ? "budget.accountInHistory" : "budget.sheetInHistory");
}

type EditorialGate =
  { ok: false; res: NextResponse } | { ok: true; actorId: string; budgetId: string };

export async function gateEditorialChange(
  target: { budget: string } | { change: string },
): Promise<EditorialGate> {
  const deny = (error: string, status: number): EditorialGate => ({
    ok: false,
    res: fail(status, error),
  });

  const g = await gate(canChangeLockedBudget, "auth.treasurerEditorialChanges");
  if (!g.ok) return { ok: false, res: g.res };
  const actorId = g.actor.id;

  const budget =
    "budget" in target
      ? await prisma.budget.findUnique({
          where: { id: target.budget },
          select: { id: true, lockedAt: true },
        })
      : ((
          await prisma.budgetChange.findUnique({
            where: { id: target.change },
            select: { budget: { select: { id: true, lockedAt: true } } },
          })
        )?.budget ?? null);

  if (!budget) return deny("budget.notFound", 404);
  // Only a locked budget has something to depart from.
  if (!budget.lockedAt) {
    return deny("budget.notLocked", 409);
  }
  return { ok: true, actorId, budgetId: budget.id };
}
