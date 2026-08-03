// Validation shared by the two endpoints that set a budget account's code.
//
// Budget accounts used to be two free-text fields, so a typo produced a code
// that matched nothing in the ledger and silently showed no actuals. Now the
// code must exist in the synced chart (see Settings → Fortnox), and the
// name is taken from the chart rather than typed.
import { prisma } from "@/lib/server/db";

// Discriminated on `ok`, so a caller that returns early on failure has a code
// and a name in hand afterwards without asserting they are there. On failure,
// `error` is a message code under `errors.budgetAccount` — see lib/api/guard.
export type AccountCheck =
  | { ok: true; code: string; name: string }
  | { ok: false; error: string; values?: Record<string, string | number> };

export async function resolveBudgetAccount(rawCode: string): Promise<AccountCheck> {
  const code = rawCode.trim();
  if (!code) return { ok: false, error: "budgetAccount.codeRequired" };

  const account = await prisma.account.findUnique({ where: { number: code } });
  if (!account) {
    // An empty chart means nobody has synced yet — say that rather than
    // blaming the account number.
    const charted = await prisma.account.count();
    return charted
      ? { ok: false, error: "budgetAccount.unknown", values: { code } }
      : { ok: false, error: "budgetAccount.emptyChart" };
  }
  return { ok: true, code: account.number, name: account.name };
}
