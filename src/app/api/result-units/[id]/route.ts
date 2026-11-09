// Deleting is refused while anything depends on the unit (resultatansvar, expenses waiting on attest); the caller is told what is in the way.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { canAccessSettings } from "@/lib/domain/permissions";
import { costCentreWhereForPrefixes } from "@/lib/server/result-units";
import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { serializable } from "@/lib/server/tx";
import { ResultUnitBody } from "@/lib/api/schemas/admin";

const AWAITING_ATTEST = ["PENDING_APPROVAL", "CHANGES_REQUESTED"] as const;

const admin = () => gate(canAccessSettings, "auth.adminOnly");

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await admin();
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, ResultUnitBody);
  if (!parsed.ok) return parsed.res;
  const { name } = parsed.data;

  // The old name, to carry resultatansvar (held by name) over.
  const existing = await prisma.resultUnit.findUnique({ where: { id } });
  if (!existing) return fail(404, "resultUnit.notFound");

  const clash = await prisma.resultUnit.findUnique({ where: { name } });
  if (clash && clash.id !== id) return fail(409, "resultUnit.exists", { values: { name } });

  if (existing.name === name) return NextResponse.json(existing);

  // User.resultUnits holds names, not a foreign key: a rename must update them or canAttestAllocation stops matching and attest queues empty.
  // Both in one serializable transaction.
  const resultUnit = await serializable(async (tx) => {
    const updated = await tx.resultUnit.update({ where: { id }, data: { name } });
    // Every holder, including those reapplyGrants cannot reach. Names are bound values, never interpolated.
    await tx.$executeRaw`
      UPDATE "User"
         SET "resultUnits" = array_replace("resultUnits", ${existing.name}, ${name})
       WHERE ${existing.name} = ANY("resultUnits")
    `;
    return updated;
  });
  return NextResponse.json(resultUnit);
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await admin();
  if (!g.ok) return g.res;

  const resultUnit = await prisma.resultUnit.findUnique({
    where: { id },
    include: { prefixes: true },
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

  // One code per refusal shape. Resultatansvar is held by name, so deleting would strand users: fix the mapping in lib/server/authentik-roles.ts first.
  const owners = await prisma.user.count({
    where: { resultUnits: { has: resultUnit.name } },
  });
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
