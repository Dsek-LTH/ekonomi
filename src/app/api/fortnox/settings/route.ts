// Bookkeeping settings surfaced in Inställningar → Fortnox: the voucher series
// exports land in (a property of the connection) and the accounts the booking
// view pre-fills (app config, kept across a disconnect).
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { canAccessSettings } from "@/lib/domain/permissions";
import { getBookkeepingSettings } from "@/lib/data/accounts";
import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { FortnoxSettings } from "@/lib/api/schemas/admin";

export async function PATCH(req: Request) {
  const g = await gate(canAccessSettings, "auth.adminBookkeepingSettings");
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, FortnoxSettings);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;
  const data: { bankAccount?: string; memberDebtAccount?: string } = {};

  // The schema says these are non-empty strings; that each names an account in
  // the synced chart is what the lookup below establishes, and is the check
  // worth having — a voucher posted to a number Fortnox has never heard of is
  // the failure this prevents.
  for (const field of ["bankAccount", "memberDebtAccount"] as const) {
    const value = body[field];
    if (value === undefined) continue;
    const account = await prisma.account.findUnique({ where: { number: value } });
    if (!account) return fail(422, "budgetAccount.unknown", { values: { code: value } });
    data[field] = account.number;
  }

  if (Object.keys(data).length) {
    await prisma.bookkeepingSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", ...data },
      update: data,
    });
  }

  // The voucher series lives on the connection — only settable while connected.
  if (body.voucherSeries !== undefined) {
    const conn = await prisma.fortnoxConnection.findFirst();
    if (!conn) {
      return fail(409, "fortnox.notConnectedSeries");
    }
    await prisma.fortnoxConnection.update({
      where: { id: conn.id },
      data: { voucherSeries: body.voucherSeries },
    });
  }

  return NextResponse.json({ settings: await getBookkeepingSettings() });
}
