// Puts a write's own answer into the budget on screen instead of reading it all back. Pure
// functions from a budget and a change to the budget after it. Each mirrors its route on the
// server (the reorder is tested against the same description).
import type { Account, Budget, BudgetCC, Comment, LineItem, Variable } from "./budget-types";

export function withAccount(b: Budget, accountId: string, fn: (a: Account) => Account): Budget {
  return {
    ...b,
    costCenters: b.costCenters.map((cc) => ({
      ...cc,
      accounts: cc.accounts.map((a) => (a.id === accountId ? fn(a) : a)),
    })),
  };
}

export function withSheet(b: Budget, sheetId: string, fn: (cc: BudgetCC) => BudgetCC): Budget {
  return { ...b, costCenters: b.costCenters.map((cc) => (cc.id === sheetId ? fn(cc) : cc)) };
}

export function withLine(b: Budget, accountId: string, line: LineItem): Budget {
  return withAccount(b, accountId, (a) => ({ ...a, lineItems: [...a.lineItems, line] }));
}

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
 * The budget with a created account placed in account-number order, as
 * lib/data/budget.ts sorts, so it does not jump on reload. BAS codes are four digits, so
 * string comparison is numeric.
 */
export function withNewAccount(b: Budget, sheetId: string, account: Account): Budget {
  return withSheet(b, sheetId, (cc) => ({
    ...cc,
    accounts: [...cc.accounts, account].sort((x, y) => x.accountCode.localeCompare(y.accountCode)),
  }));
}

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
 * The budget with `orderedIds` as the rows of `accountId`. The reorder route's rule (see
 * budget-accounts/[id]/line-items/reorder): a named row now belongs to this account and the
 * accounts it leaves keep their order.
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
              // An unknown id is dropped, as the route does.
              lineItems: orderedIds.flatMap((id) => rows.get(id) ?? []),
            }
          : { ...a, lineItems: a.lineItems.filter((li) => !named.has(li.id)) },
      ),
    })),
  };
}

export function withVariable(b: Budget, variable: Variable): Budget {
  return { ...b, variables: [...b.variables, variable] };
}

export function withoutVariable(b: Budget, variableId: string): Budget {
  return { ...b, variables: b.variables.filter((v) => v.id !== variableId) };
}

/** The budget with a comment added to or taken off an account (nothing re-derived). */
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
