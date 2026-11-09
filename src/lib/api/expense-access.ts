// Who may see, edit and delete one utlägg. Checks, not loaders (routes already fetch the expense). The viewing rule
// lives in lib/data/expense-scope.ts.
import { NextResponse } from "next/server";
import { expenseScopeOf, scopeIncludes } from "@/lib/data/expense-scope";
import { isAdmin } from "@/lib/domain/permissions";
import { isSigned } from "@/lib/domain/status";
import { fail, type Actor } from "@/lib/api/guard";

/** Whether `actor` may see this expense at all, see `ExpenseScope`. */
async function canViewExpense(
  actor: Actor,
  expense: { id: string; submitterId: string },
): Promise<boolean> {
  return scopeIncludes(await expenseScopeOf(actor), expense);
}

/** A hidden expense answers 404, not 403 (its existence is not the caller's business). Returns that response, or null when in scope. */
export async function denyExpenseView(
  actor: Actor,
  expense: { id: string; submitterId: string },
): Promise<NextResponse | null> {
  return (await canViewExpense(actor, expense)) ? null : fail(404, "expense.notFound");
}

/** Whether `actor` may change this expense's fields: the submitter or an admin (also limited by status, see `isEditable`). */
export const canEditExpense = (actor: Actor, expense: { submitterId: string }) =>
  expense.submitterId === actor.id || isAdmin(actor.capabilities);

/** Whether `actor` may delete this expense and its receipts: an admin any, the submitter their own until signed. */
export function denyExpenseDelete(
  actor: Actor,
  expense: { submitterId: string; status: string },
): NextResponse | null {
  if (isAdmin(actor.capabilities)) return null;
  const isOwner = expense.submitterId === actor.id;
  if (isOwner && !isSigned(expense.status)) return null;
  return fail(403, isOwner ? "expense.deleteSignedAdminOnly" : "expense.noDeleteAccess");
}
