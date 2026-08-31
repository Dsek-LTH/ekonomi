// Create a result unit (admin only). Which cost centres belong to it is decided
// by its prefixes, see app/api/result-units/[id]/prefixes.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { canAccessSettings } from "@/lib/domain/permissions";
import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { ResultUnitBody } from "@/lib/api/schemas/admin";

export async function POST(req: Request) {
  const g = await gate(canAccessSettings, "auth.adminOnly");
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, ResultUnitBody);
  if (!parsed.ok) return parsed.res;
  const { name } = parsed.data;

  if (await prisma.resultUnit.findUnique({ where: { name } })) {
    return fail(409, "resultUnit.exists", { values: { name } });
  }

  const resultUnit = await prisma.resultUnit.create({ data: { name } });
  return NextResponse.json(resultUnit, { status: 201 });
}
