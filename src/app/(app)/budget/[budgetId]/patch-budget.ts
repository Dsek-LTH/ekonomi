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

/** The budget with some of a line's own fields written (a cell edit, as the PATCH route does). */
export function withLineFields(
  b: Budget,
  lineId: string,
  fields: Partial<Pick<LineItem, "description" | "expression">>,
): Budget {
  return {
    ...b,
    costCenters: b.costCenters.map((cc) => ({
      ...cc,
      accounts: cc.accounts.map((a) => ({
        ...a,
        lineItems: a.lineItems.map((li) => (li.id === lineId ? { ...li, ...fields } : li)),
      })),
    })),
  };
}

export function withLine(b: Budget, accountId: string, line: LineItem): Budget {
  // The create route answers with the bare row: a new line has nothing said about it yet.
  const made = { ...line, comments: line.comments ?? [] };
  return withAccount(b, accountId, (a) => ({ ...a, lineItems: [...a.lineItems, made] }));
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
 * Accounts in account-number order, as lib/data/budget.ts sorts, so nothing jumps on reload.
 * BAS codes are four digits, so string comparison is numeric.
 */
function byCode(accounts: Account[]): Account[] {
  return [...accounts].sort((x, y) => x.accountCode.localeCompare(y.accountCode));
}

/** The budget with a created account placed in account-number order. */
export function withNewAccount(b: Budget, sheetId: string, account: Account): Budget {
  return withSheet(b, sheetId, (cc) => ({ ...cc, accounts: byCode([...cc.accounts, account]) }));
}

/** The budget with an account's number (and the name that comes with it) changed, re-sorted. */
export function withAccountCode(
  b: Budget,
  accountId: string,
  accountCode: string,
  accountName: string,
): Budget {
  return {
    ...b,
    costCenters: b.costCenters.map((cc) =>
      cc.accounts.some((a) => a.id === accountId)
        ? {
            ...cc,
            accounts: byCode(
              cc.accounts.map((a) => (a.id === accountId ? { ...a, accountCode, accountName } : a)),
            ),
          }
        : cc,
    ),
  };
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

/**
 * The budget with a comment added: on an account (`lineId` null), or on a line or one of its
 * cells (the comment's own `field` says which). Nothing is re-derived.
 */
export function withComment(
  b: Budget,
  at: { accountId: string } | { lineId: string },
  comment: Comment,
): Budget {
  if ("accountId" in at)
    return withAccount(b, at.accountId, (a) => ({ ...a, comments: [...a.comments, comment] }));
  return {
    ...b,
    costCenters: b.costCenters.map((cc) => ({
      ...cc,
      accounts: cc.accounts.map((a) => ({
        ...a,
        lineItems: a.lineItems.map((li) =>
          li.id === at.lineId ? { ...li, comments: [...(li.comments ?? []), comment] } : li,
        ),
      })),
    })),
  };
}

/** The budget without a comment, wherever it was pinned. */
export function withoutComment(b: Budget, commentId: string): Budget {
  const keep = (c: Comment) => c.id !== commentId;
  return {
    ...b,
    costCenters: b.costCenters.map((cc) => ({
      ...cc,
      accounts: cc.accounts.map((a) => ({
        ...a,
        comments: a.comments.filter(keep),
        lineItems: a.lineItems.map((li) => ({ ...li, comments: (li.comments ?? []).filter(keep) })),
      })),
    })),
  };
}
