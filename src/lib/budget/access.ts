// The gate every budget write goes through: the admin check each route used to
// carry its own copy of, plus the lock.
//
// A locked budget rejects writes to its numbers wherever they enter from, and
// they enter from all over. A line item is patched by its own id, an account by
// its id, a cost centre by its id. So the guard takes whichever id the route has
// and walks back up to the budget itself, rather than expecting every caller to
// know how to find it. Comments are deliberately not routed through here: they
// stay open on a locked budget (see Budget in schema.prisma).
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { canChangeLockedBudget, isAdmin } from "@/lib/domain/permissions";
import { fail, gate, type Gate } from "@/lib/api/guard";

// Which entity the route was handed. Exactly one key.
type BudgetTarget =
  | { budget: string }
  | { costCenter: string } // BudgetCostCenter id (a sheet), not CostCenter
  | { account: string }
  | { lineItem: string }
  | { variable: string };

const budgetLock = { select: { lockedAt: true } } as const;

// The lock state of the budget `target` belongs to. `null` when the row (or the
// budget above it) no longer exists.
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
 *
 * The same `{ ok }` shape as `gate()` in lib/api/guard.ts, and deliberately.
 * this *is* the gate for the budget routes, the only authority check most of
 * them make. It used to answer with a response-or-null:
 *
 *     const denied = await denyBudgetWrite({ account: id });
 *     if (denied) return denied;
 *
 * which reads fine and fails badly. Nothing afterwards used `denied`, so a
 * handler that dropped the second line compiled, ran, and was unguarded. The
 * one shape of mistake that must not be silent. Answering like `gate` means the
 * actor comes back with the verdict, the handler has to unwrap it to get at
 * them, and forgetting is a type error rather than an open door.
 *
 *     const g = await allowBudgetWrite({ account: id });
 *     if (!g.ok) return g.res;
 *
 * The other `deny*` helpers keep their shape on purpose. `denyDeletingAdjusted`
 * below and `denyNoFortnox` are preconditions rather than gates. They answer
 * "is there a reason to refuse this", not "who is acting", and
 * `denyExpenseView` is applied to an actor the handler has already resolved
 * through `gate`. None of them can be the only thing standing between a request
 * and a write.
 */
export async function allowBudgetWrite(target: BudgetTarget): Promise<Gate> {
  const g = await gate(isAdmin);
  if (!g.ok) return g;

  const lock = await findLock(target);
  if (!lock) return { ok: false, res: fail(404, "notFound") };
  if (lock.lockedAt) return { ok: false, res: fail(409, "budget.locked") };
  return g;
}

// The other door, redaktionella ändringar. The gate above is the ordinary one,
// and it closes when the budget is locked. This is the one that only opens
// then: a locked budget is changed by recording
// a BudgetChange beside it (see schema.prisma), which the skattmästare alone may
// do. Written apart from `allowBudgetWrite` rather than folded into it. The two
// want opposite things from the lock, and the caller needs to know who is
// acting, since the change is signed.

/**
 * Refuses to delete an account (or a whole sheet) that the editorial history
 * names. The adjustment rows cascade with it in the database, so allowing the
 * delete would quietly rewrite what a recorded change says was decided. Revoked
 * changes count too: they are struck through in the history, not gone from it.
 *
 * Deleting the whole budget still works, and should: then the history goes with
 * the thing it is a history of.
 */
export async function denyDeletingAdjusted(
  target: { account: string } | { costCenter: string },
): Promise<NextResponse | null> {
  const where =
    "account" in target
      ? { accountId: target.account }
      : { account: { budgetCostCenterId: target.costCenter } };

  const found = await prisma.budgetAdjustment.findFirst({ where, select: { id: true } });
  if (!found) return null;

  return fail(
    409,
    "account" in target ? "budget.accountInHistory" : "budget.sheetInHistory",
  );
}

type EditorialGate =
  | { ok: false; res: NextResponse }
  | { ok: true; actorId: string; budgetId: string };

/**
 * Whether this request may record, or revoke, a change on the budget
 * `target` names. Reads:
 *
 *     const gate = await gateEditorialChange({ budget: id });
 *     if (!gate.ok) return gate.res;
 */
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
      ? await prisma.budget.findUnique({ where: { id: target.budget }, select: { id: true, lockedAt: true } })
      : (await prisma.budgetChange.findUnique({
          where: { id: target.change },
          select: { budget: { select: { id: true, lockedAt: true } } },
        }))?.budget ?? null;

  if (!budget) return deny("budget.notFound", 404);
  // The lock is what a change departs from. Without one there is nothing to
  // record against: an open budget is simply edited.
  if (!budget.lockedAt) {
    return deny("budget.notLocked", 409);
  }
  return { ok: true, actorId, budgetId: budget.id };
}
