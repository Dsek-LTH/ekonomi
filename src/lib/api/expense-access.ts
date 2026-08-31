// Who may see, edit and delete one utlägg.
//
// The viewing rule itself lives in lib/data/expense-scope.ts, alongside the
// filter the list queries use: one statement of who may see what, asked here
// in the shape a route needs.
//
// These are checks, not loaders: every route already fetches the expense with
// the fields it needs, so wrapping the query as well would only make each one
// ask for columns it has no use for.
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

/**
 * A hidden expense answers 404, not 403. That someone else's utlägg exists is
 * itself not the caller's business. Returns the response to send when the
 * expense is out of scope, and null when it is in.
 */
export async function denyExpenseView(
  actor: Actor,
  expense: { id: string; submitterId: string },
): Promise<NextResponse | null> {
  return (await canViewExpense(actor, expense))
    ? null
    : fail(404, "expense.notFound");
}

/** Whether `actor` may change this expense's own fields: the submitter, or an
 *  admin. Editing is additionally limited by status, see `isEditable`. */
export const canEditExpense = (actor: Actor, expense: { submitterId: string }) =>
  expense.submitterId === actor.id || isAdmin(actor.capabilities);

/**
 * Whether `actor` may delete this expense, and the receipts hanging off it.
 * An admin may delete any; the submitter may delete their own until it is
 * signed, after which the expense is part of the guild's records.
 */
export function denyExpenseDelete(
  actor: Actor,
  expense: { submitterId: string; status: string },
): NextResponse | null {
  if (isAdmin(actor.capabilities)) return null;
  const isOwner = expense.submitterId === actor.id;
  if (isOwner && !isSigned(expense.status)) return null;
  return fail(403, isOwner ? "expense.deleteSignedAdminOnly" : "expense.noDeleteAccess");
}
