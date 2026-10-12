// Putting a write's own answer into the budget on screen, instead of reading
// the whole budget back to find out what it did.
//
// A write used to be: POST, then re-fetch the budget, then re-render every
// sheet in it. But a create route hands back the row it created, a delete says
// it deleted, and a reorder was the client's own arrangement to begin with, so
// in each case the screen already knows what changed, and what it needs is a
// way to say so. That is all this file is: pure functions from a budget and a
// change to the budget after it.
//
// Each mirrors what its route does on the server, which is the thing to be
// careful about: a rule written twice can be written differently twice. Where
// that risk is real (the reorder, which also moves a row between accounts) it
// is tested against the same description the route is written to.
import type { Account, Budget, BudgetCC, Comment, LineItem, Variable } from "./budget-types";

/** The budget with `fn` applied to the account it holds under `accountId`. */
export function withAccount(b: Budget, accountId: string, fn: (a: Account) => Account): Budget {
  return {
    ...b,
    costCenters: b.costCenters.map((cc) => ({
      ...cc,
      accounts: cc.accounts.map((a) => (a.id === accountId ? fn(a) : a)),
    })),
  };
}

/** The budget with `fn` applied to one sheet. */
export function withSheet(b: Budget, sheetId: string, fn: (cc: BudgetCC) => BudgetCC): Budget {
  return { ...b, costCenters: b.costCenters.map((cc) => (cc.id === sheetId ? fn(cc) : cc)) };
}

/** The budget with a row appended to an account (a created line, as returned). */
export function withLine(b: Budget, accountId: string, line: LineItem): Budget {
  return withAccount(b, accountId, (a) => ({ ...a, lineItems: [...a.lineItems, line] }));
}

/** The budget without a row, wherever it is. */
export function withoutLine(b: Budget, lineId: string): Budget {
  return {
    ...b,
    costCenters: b.costCenters.map((cc) => ({
      ...cc,
      accounts: cc.accounts.map((a) => ({
        ...a,
        lineItems: a.lineItems.filter((li) => li.id !== lineId),
      })),
    })),
  };
}

/**
 * The budget with a created account put into a sheet, in account-number order.
 *
 * Placed, not appended. The sheet is ordered by account code (lib/data/budget.ts),
 * so a new 3010 dropped at the end would sit under 5800 until the next reload
 * and then jump, which reads as the app having changed its mind about where the
 * row goes. Same rule on both sides of the wire, so the optimistic sheet and the
 * reloaded one agree.
 *
 * BAS codes are four digits throughout, so comparing them as strings is
 * comparing them as numbers.
 */
export function withNewAccount(b: Budget, sheetId: string, account: Account): Budget {
  return withSheet(b, sheetId, (cc) => ({
    ...cc,
    accounts: [...cc.accounts, account].sort((x, y) =>
      x.accountCode.localeCompare(y.accountCode),
    ),
  }));
}

/** The budget without an account, and so without the rows that hung off it. */
export function withoutAccount(b: Budget, accountId: string): Budget {
  return {
    ...b,
    costCenters: b.costCenters.map((cc) => ({
      ...cc,
      accounts: cc.accounts.filter((a) => a.id !== accountId),
    })),
  };
}

/**
 * The budget with `orderedIds` as the rows of `accountId`, in that order.
 *
 * The reorder route's rule exactly (see budget-accounts/[id]/line-items/reorder):
 * a row named here belongs to this account now, whichever account it was under
 * before, and the accounts it leaves keep the order they had. Which is what
 * makes dragging a row from one account to another one arrangement and not two.
 */
export function withLineOrder(b: Budget, accountId: string, orderedIds: string[]): Budget {
  const named = new Set(orderedIds);
  const rows = new Map<string, LineItem>();
  for (const cc of b.costCenters) {
    for (const a of cc.accounts) {
      for (const li of a.lineItems) if (named.has(li.id)) rows.set(li.id, li);
    }
  }
  return {
    ...b,
    costCenters: b.costCenters.map((cc) => ({
      ...cc,
      accounts: cc.accounts.map((a) =>
        a.id === accountId
          ? {
              ...a,
              // An id the budget has never heard of is dropped rather than
              // carried as a hole. The route drops it too, for the same reason.
              lineItems: orderedIds.flatMap((id) => rows.get(id) ?? []),
            }
          : { ...a, lineItems: a.lineItems.filter((li) => !named.has(li.id)) },
      ),
    })),
  };
}

/** The budget with a variable appended (a created one, as returned). */
export function withVariable(b: Budget, variable: Variable): Budget {
  return { ...b, variables: [...b.variables, variable] };
}

/** The budget without a variable. Every formula naming it now fails, which is
 *  what the re-derived figures will say, and is the truth. */
export function withoutVariable(b: Budget, variableId: string): Budget {
  return { ...b, variables: b.variables.filter((v) => v.id !== variableId) };
}

/** The budget with a comment added to an account, or taken off it. Comments are
 *  not part of any figure, so nothing is re-derived by either. */
export function withComment(b: Budget, accountId: string, comment: Comment): Budget {
  return withAccount(b, accountId, (a) => ({ ...a, comments: [...a.comments, comment] }));
}

export function withoutComment(b: Budget, commentId: string): Budget {
  return {
    ...b,
    costCenters: b.costCenters.map((cc) => ({
      ...cc,
      accounts: cc.accounts.map((a) => ({
        ...a,
        comments: a.comments.filter((c) => c.id !== commentId),
      })),
    })),
  };
}
