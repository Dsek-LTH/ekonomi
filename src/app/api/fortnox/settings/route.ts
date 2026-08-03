// Bookkeeping settings surfaced in Inställningar → Fortnox: the voucher series
// exports land in (a property of the connection) and the accounts the booking
// view pre-fills (app config, kept across a disconnect).
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { canAccessSettings } from "@/lib/domain/permissions";
import { getBookkeepingSettings } from "@/lib/data/accounts";
import { fail, gate } from "@/lib/api/guard";

export async function PATCH(req: Request) {
  const g = await gate(canAccessSettings, "auth.adminBookkeepingSettings");
  if (!g.ok) return g.res;

  const body = await req.json().catch(() => ({}));
  const data: { bankAccount?: string; memberDebtAccount?: string } = {};

  for (const field of ["bankAccount", "memberDebtAccount"] as const) {
    const value = body[field];
    if (value === undefined) continue;
    if (typeof value !== "string" || !value.trim()) {
      return fail(422, "fortnox.settingNotAccount", { values: { field } });
    }
    const account = await prisma.account.findUnique({ where: { number: value.trim() } });
    if (!account) return fail(422, "budgetAccount.unknown", { values: { code: value.trim() } });
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
  if (typeof body.voucherSeries === "string" && body.voucherSeries.trim()) {
    const conn = await prisma.fortnoxConnection.findFirst();
    if (!conn) {
      return fail(409, "fortnox.notConnectedSeries");
    }
    await prisma.fortnoxConnection.update({
      where: { id: conn.id },
      data: { voucherSeries: body.voucherSeries.trim().toUpperCase() },
    });
  }

  return NextResponse.json({ ok: true, settings: await getBookkeepingSettings() });
}
