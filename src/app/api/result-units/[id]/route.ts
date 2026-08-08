// Rename or delete one result unit (admin only).
//
// Deleting is refused while anything still depends on the result unit: its
// resultatansvarig would silently lose attest authority, and any expense waiting
// on attest under one of its cost centres would become admin-only. The caller
// is told exactly what is in the way.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { canAccessSettings } from "@/lib/domain/permissions";
import { costCentreWhereForPrefixes } from "@/lib/server/result-units";
import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { ResultUnitBody } from "@/lib/api/schemas/admin";

// Statuses where an expense still needs someone with attest authority.
const AWAITING_ATTEST = ["PENDING_APPROVAL", "CHANGES_REQUESTED"] as const;

const admin = () => gate(canAccessSettings, "auth.adminOnly");

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await admin();
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, ResultUnitBody);
  if (!parsed.ok) return parsed.res;
  const { name } = parsed.data;

  const clash = await prisma.resultUnit.findUnique({ where: { name } });
  if (clash && clash.id !== id) return fail(409, "resultUnit.exists", { values: { name } });

  const resultUnit = await prisma.resultUnit.update({ where: { id }, data: { name } });
  return NextResponse.json(resultUnit);
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await admin();
  if (!g.ok) return g.res;

  const resultUnit = await prisma.resultUnit.findUnique({
    where: { id },
    include: { prefixes: true, _count: { select: { owners: true } } },
  });
  if (!resultUnit) return fail(404, "resultUnit.notFound");

  const prefixes = resultUnit.prefixes.map((p) => p.value);
  const pending = prefixes.length
    ? await prisma.expense.count({
        where: {
          status: { in: [...AWAITING_ATTEST] },
          allocations: { some: { costCenter: costCentreWhereForPrefixes(prefixes) } },
        },
      })
    : 0;

  // One code per shape of the refusal, so each message is a plain sentence
  // with a plural or two rather than a template that has to compose itself.
  const owners = resultUnit._count.owners;
  if (owners > 0 && pending > 0) {
    return fail(409, "resultUnit.deleteBlockedBoth", {
      values: { name: resultUnit.name, owners, pending },
    });
  }
  if (owners > 0) {
    return fail(409, "resultUnit.deleteBlockedOwners", {
      values: { name: resultUnit.name, owners },
    });
  }
  if (pending > 0) {
    return fail(409, "resultUnit.deleteBlockedPending", {
      values: { name: resultUnit.name, pending },
    });
  }

  await prisma.resultUnit.delete({ where: { id } });
  return new Response(null, { status: 204 });
}
