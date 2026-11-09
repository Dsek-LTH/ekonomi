// Validation shared by the endpoints that set a budget account's code: it must exist in the synced chart, which supplies the name.
import { prisma } from "@/lib/server/db";
import { effectiveKind, isResultAccount, type AccountKind } from "@/lib/budget";

// `error` is a message code under `errors.budgetAccount`.
type AccountCheck =
  | { ok: true; code: string; name: string }
  | { ok: false; error: string; values?: Record<string, string | number> };

/**
 * `expect` is the section the account is added under (5010 under Intäkter is refused).
 * Omitted on rename, where the code decides the side.
 */
export async function resolveBudgetAccount(
  rawCode: string,
  expect?: AccountKind,
): Promise<AccountCheck> {
  const code = rawCode.trim();
  if (!code) return { ok: false, error: "budgetAccount.codeRequired" };

  const account = await prisma.account.findUnique({ where: { number: code } });
  if (!account) {
    // An empty chart means nobody has synced yet.
    const charted = await prisma.account.count();
    return charted
      ? { ok: false, error: "budgetAccount.unknown", values: { code } }
      : { ok: false, error: "budgetAccount.emptyChart" };
  }
  // The balansräkning (1xxx, 2xxx) is not budgeted.
  if (!isResultAccount(account.number)) {
    return {
      ok: false,
      error: "budgetAccount.notResultAccount",
      values: { code: account.number },
    };
  }
  // 3xxx is income, 4xxx-8xxx is cost, whatever a budget says.
  if (expect && effectiveKind(account.number) !== expect) {
    return {
      ok: false,
      error: expect === "INCOME" ? "budgetAccount.notIncome" : "budgetAccount.notCost",
      values: { code: account.number },
    };
  }
  return { ok: true, code: account.number, name: account.name };
}
