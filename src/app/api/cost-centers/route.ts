import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { canAccessSettings } from "@/lib/domain/permissions";
import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { CreateCostCenter } from "@/lib/api/schemas/admin";

// Same shape as a Fortnox code: the result unit that attests a cost centre is resolved from its prefix.
const CODE = /^[A-ZÅÄÖ0-9_-]{2,20}$/;

export async function POST(req: Request) {
  const g = await gate(canAccessSettings, "auth.adminCreateCostCenter");
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, CreateCostCenter);
  if (!parsed.ok) return parsed.res;
  const { code, name } = parsed.data;

  if (!CODE.test(code)) {
    return fail(422, "costCenter.codeFormat");
  }

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
