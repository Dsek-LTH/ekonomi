// Sync the chart of accounts from Fortnox into the local Account table.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { canAccessSettings } from "@/lib/domain/permissions";
import { syncAccounts, syncFinancialYears } from "@/lib/fortnox/sync";
import { fail } from "@/lib/api/guard";
import { fortnoxFailure, gateFortnoxService } from "@/lib/api/fortnox-route";

export async function POST() {
  const g = await gateFortnoxService(
    canAccessSettings,
    "auth.adminSyncChart",
  );
  if (!g.ok) return g.res;

  try {
    // The chart is per financial year, so pick the year containing today and
    // fall back to the newest one Fortnox knows about.
    const years = await syncFinancialYears(g.token);
    const today = new Date().toISOString().slice(0, 10);
    const target = years.find((y) => y.fromDate <= today && today <= y.toDate) ?? years[0];
    if (!target) {
      return fail(409, "fortnox.noFinancialYears");
    }

    const result = await syncAccounts(g.token, target.id);
    const total = await prisma.account.count();
    return NextResponse.json({ ...result, total, year: target.id });
  } catch (e) {
    return fortnoxFailure(e);
  }
}
