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
import { serializable } from "@/lib/server/tx";
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

  // The old name, before anything changes it: resultatansvar is held *by name*
  // and has to be carried over to the new one below.
  const existing = await prisma.resultUnit.findUnique({ where: { id } });
  if (!existing) return fail(404, "resultUnit.notFound");

  const clash = await prisma.resultUnit.findUnique({ where: { name } });
  if (clash && clash.id !== id) return fail(409, "resultUnit.exists", { values: { name } });

  if (existing.name === name) return NextResponse.json(existing);

  // User.resultUnits is a String[] of result unit *names*, not a foreign key
  // (see the note on the delete below, and the column in the schema). So a
  // rename that touched only this row left every resultatansvarig answering for
  // a string that no longer resolves: `canAttestAllocation` compares the two
  // literally, their attest queue silently emptied, and nothing anywhere said
  // so. The delete beside this refuses to leave that state behind; a rename must
  // not be allowed to create it.
  //
  // Both in one transaction, and serializable: a rename that half-applied is the
  // same broken state, only harder to find afterwards.
  const resultUnit = await serializable(async (tx) => {
    const updated = await tx.resultUnit.update({ where: { id }, data: { name } });
    // Every holder, including the ones `reapplyGrants` cannot reach — somebody
    // who has not signed in since authentikGroups existed holds the name and no
    // derivable grant, and is exactly who a rename would otherwise strand.
    //
    // Parameterised by the tagged template: both names are bound values, never
    // interpolated into the statement.
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

  // One code per shape of the refusal, so each message is a plain sentence
  // with a plural or two rather than a template that has to compose itself.
  //
  // Resultatansvar is held by name, not by a foreign key, so deleting the unit
  // would not cascade — it would leave those users answering for a name that
  // no longer resolves. Still a refusal, and now also a nudge to fix the
  // mapping in lib/server/authentik-roles.ts first.
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
