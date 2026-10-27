// Validation shared by the two endpoints that set a budget account's code.
//
// Budget accounts used to be two free-text fields, so a typo produced a code
// that matched nothing in the ledger and silently showed no actuals. Now the
// code must exist in the synced chart (see Settings → Fortnox), and the
// name is taken from the chart rather than typed.
import { prisma } from "@/lib/server/db";
import { effectiveKind, isResultAccount, type AccountKind } from "@/lib/budget";

// Discriminated on `ok`, so a caller that returns early on failure has a code
// and a name in hand afterwards without asserting they are there. On failure,
// `error` is a message code under `errors.budgetAccount`, see lib/api/guard.
type AccountCheck =
  | { ok: true; code: string; name: string }
  | { ok: false; error: string; values?: Record<string, string | number> };

/**
 * Check a code, and where given, that it belongs on the side it is being put.
 *
 * `expect` is the section the account is being added under, so that picking
 * 5010 under Intäkter is refused rather than quietly filed there. Left off by
 * the rename in PATCH, which has no section to answer to: an account renamed
 * from 3010 to 5010 simply moves to Kostnader, because the side is the code's
 * to decide and the sheet redraws from it.
 */
export async function resolveBudgetAccount(
  rawCode: string,
  expect?: AccountKind,
): Promise<AccountCheck> {
  const code = rawCode.trim();
  if (!code) return { ok: false, error: "budgetAccount.codeRequired" };

  const account = await prisma.account.findUnique({ where: { number: code } });
  if (!account) {
    // An empty chart means nobody has synced yet, say that rather than
    // blaming the account number.
    const charted = await prisma.account.count();
    return charted
      ? { ok: false, error: "budgetAccount.unknown", values: { code } }
      : { ok: false, error: "budgetAccount.emptyChart" };
  }
  // The balansräkning is not budgeted. A 1xxx or 2xxx account used to be
  // pickable and was silently filed as a cost, so a bank balance could sit in a
  // column of expenses with nothing to say it was wrong.
  if (!isResultAccount(account.number)) {
    return { ok: false, error: "budgetAccount.notResultAccount", values: { code: account.number } };
  }
  // And on the side its number puts it on. 3xxx is income, 4xxx-8xxx is cost,
  // and that is what the ledger will report whatever a budget says about it.
  if (expect && effectiveKind(account.number) !== expect) {
    return {
      ok: false,
      error: expect === "INCOME" ? "budgetAccount.notIncome" : "budgetAccount.notCost",
      values: { code: account.number },
    };
  }
  return { ok: true, code: account.number, name: account.name };
}
