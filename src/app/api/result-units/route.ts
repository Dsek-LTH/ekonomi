// Create a result unit (admin only). Which cost centres belong to it is decided
// by its prefixes — see app/api/result-units/[id]/prefixes.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { canAccessSettings } from "@/lib/domain/permissions";
import { fail, gate } from "@/lib/api/guard";

export async function POST(req: Request) {
  const g = await gate(canAccessSettings, "auth.adminOnly");
  if (!g.ok) return g.res;

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return fail(422, "resultUnit.nameRequired");

  if (await prisma.resultUnit.findUnique({ where: { name } })) {
    return fail(409, "resultUnit.exists", { values: { name } });
  }

  const resultUnit = await prisma.resultUnit.create({ data: { name } });
  return NextResponse.json(resultUnit, { status: 201 });
}
