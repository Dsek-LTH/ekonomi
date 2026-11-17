// Utlägg settings in Inställningar → Utlägg: the series utlägg are exported into and the accounts the booking view
// pre-fills. All kept in BookkeepingSettings, so they survive a disconnect.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { canAccessSettings } from "@/lib/domain/permissions";
import { getBookkeepingSettings } from "@/lib/data/accounts";
import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { ExpenseSettings } from "@/lib/api/schemas/admin";

export async function PATCH(req: Request) {
  const g = await gate(canAccessSettings, "auth.adminBookkeepingSettings");
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, ExpenseSettings);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;
  const data: {
    bankAccount?: string;
    memberDebtAccount?: string;
    expenseVoucherSeries?: string | null;
  } = {};

  // The lookup below checks each account exists in the synced chart: a voucher to an unknown number fails in Fortnox.
  for (const field of ["bankAccount", "memberDebtAccount"] as const) {
    const value = body[field];
    if (value === undefined) continue;
    const account = await prisma.account.findUnique({ where: { number: value } });
    if (!account) return fail(422, "budgetAccount.unknown", { values: { code: value } });
    data[field] = account.number;
  }

  if (body.expenseVoucherSeries !== undefined)
    data.expenseVoucherSeries = body.expenseVoucherSeries;

  if (Object.keys(data).length) {
    // Creating the row writes only what was chosen (no column has a default; lib/server/bookkeeping-settings.ts).
    await prisma.bookkeepingSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", ...data },
      update: data,
    });
  }

  return NextResponse.json({ settings: await getBookkeepingSettings() });
}
