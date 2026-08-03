// Create a local cost centre — one this app owns rather than mirrors from
// Fortnox. See CostCenterSource in the schema for why they exist.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { canAccessSettings } from "@/lib/domain/permissions";
import { fail, gate } from "@/lib/api/guard";

// Same shape as a Fortnox code so the result unit prefixes keep working: the
// result unit that attests a cost centre is resolved from its code, so "SEX01"
// routes to Sexmästeriet whether the row came from Fortnox or from here.
const CODE = /^[A-ZÅÄÖ0-9_-]{2,20}$/;

export async function POST(req: Request) {
  const g = await gate(canAccessSettings, "auth.adminCreateCostCenter");
  if (!g.ok) return g.res;

  const body = await req.json().catch(() => ({}));
  const code = String(body.code ?? "").trim().toUpperCase();
  const name = String(body.name ?? "").trim();

  if (!CODE.test(code)) {
    return fail(422, "costCenter.codeFormat");
  }
  if (!name) return fail(422, "costCenter.nameRequired");

  const existing = await prisma.costCenter.findUnique({ where: { code } });
  if (existing) {
    return fail(
      409,
      existing.source === "FORTNOX" ? "costCenter.existsInFortnox" : "costCenter.exists",
      { values: { code } },
    );
  }

  const created = await prisma.costCenter.create({
    data: { code, name, source: "LOCAL", active: true },
  });
  return NextResponse.json({ id: created.id, code: created.code, name: created.name });
}
