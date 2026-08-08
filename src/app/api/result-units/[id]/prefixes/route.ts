// Add a cost-centre code prefix to a result unit (admin only).
// Body: { value: string } — e.g. "SKT", which claims SKT01, SKT02, …
//
// Prefixes must stay non-overlapping across all result units, so a code can only
// ever match one. The check lives here because the database cannot express
// "no row is a prefix of another".
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { canAccessSettings } from "@/lib/domain/permissions";
import { normalisePrefix, prefixConflict, prefixConflictError } from "@/lib/server/result-units";
import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { AddPrefix } from "@/lib/api/schemas/admin";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: resultUnitId } = await ctx.params;
  const g = await gate(canAccessSettings, "auth.adminOnly");
  if (!g.ok) return g.res;

  if (!(await prisma.resultUnit.findUnique({ where: { id: resultUnitId } }))) {
    return fail(404, "resultUnit.notFound");
  }

  const parsed = await parseBody(req, AddPrefix);
  if (!parsed.ok) return parsed.res;
  const value = normalisePrefix(parsed.data.value);
  if (!/^[A-ZÅÄÖ0-9]+$/.test(value)) {
    return fail(422, "resultUnit.prefixFormat");
  }

  const conflict = await prefixConflict(value);
  if (conflict) {
    const { code, values } = prefixConflictError(conflict);
    return fail(409, code, { values });
  }

  const prefix = await prisma.resultUnitPrefix.create({ data: { resultUnitId, value } });
  return NextResponse.json(prefix, { status: 201 });
}
