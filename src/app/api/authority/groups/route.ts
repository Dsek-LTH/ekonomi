// What an Authentik group confers here (admin only).
//
// One group's whole grant per request — the roles it gives and the result units
// it makes someone answer for. Writing the finished state rather than a delta is
// what lets the transaction below check an outcome instead of predicting one.
//
// Three things happen inside one transaction, and they have to:
//
//   1. the rows for this group are replaced;
//   2. everyone whose stored group list touches the new mapping is re-derived,
//      so the change lands now rather than over the next day as people happen to
//      sign in (lib/server/authentik-roles.ts);
//   3. the result is checked for the one state this app must never reach —
//      nobody able to open Inställningar. If it would, the whole thing rolls
//      back and the caller is told which change did it.
//
// Step 3 is why this is not three separate endpoints. A grid saved in pieces has
// moments between the pieces, and one of those moments is a locked door.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { canAccessSettings } from "@/lib/domain/permissions";
import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { reapplyGrants } from "@/lib/server/authentik-roles";
import { isSectionGroup } from "@/lib/domain/group-name";
import { someoneCanReachSettings } from "@/lib/server/capabilities";
import { serializable } from "@/lib/server/tx";
import { DeleteGroupGrant, PutGroupGrant } from "@/lib/api/schemas/admin";

const admin = () => gate(canAccessSettings, "auth.adminOnly");

/** Raised inside the transaction to roll it back with a reason. */
class Lockout extends Error {}

export async function PUT(req: Request) {
  const g = await admin();
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, PutGroupGrant);
  if (!parsed.ok) return parsed.res;
  const { group, roles, resultUnitIds } = parsed.data;

  // The one rule no screen may edit around: a group outside `dsek.` is not the
  // section's and confers nothing however it is stored. Refused here rather
  // than stored and silently ignored at sign-in, which would be a row that
  // looks like a grant and is not.
  if (!isSectionGroup(group)) return fail(422, "authority.groupOutsideSection", { values: { group } });

  // A result unit that does not exist cannot be answered for. The foreign key
  // would refuse this anyway; saying so plainly beats a 500 from the driver.
  if (resultUnitIds.length > 0) {
    const found = await prisma.resultUnit.count({ where: { id: { in: resultUnitIds } } });
    if (found !== new Set(resultUnitIds).size) return fail(404, "resultUnit.notFound");
  }

  try {
    // Serializable, not merely transactional — see the note on `serializable`.
    // Step 3 below checks an outcome, and at READ COMMITTED a concurrent write
    // to a *different* group's rows is invisible to it: two saves that each
    // leave somebody able to reach Inställningar can commit into a state where
    // nobody can.
    const changed = await serializable(async (tx) => {
      await tx.groupRole.deleteMany({ where: { group } });
      await tx.groupResultUnit.deleteMany({ where: { group } });

      if (roles.length > 0) {
        await tx.groupRole.createMany({ data: roles.map((role) => ({ group, role })) });
      }
      if (resultUnitIds.length > 0) {
        await tx.groupResultUnit.createMany({
          data: resultUnitIds.map((resultUnitId) => ({ group, resultUnitId })),
        });
      }

      const affected = await reapplyGrants(tx);
      if (!(await someoneCanReachSettings(tx))) throw new Lockout();
      return affected;
    });

    return NextResponse.json({ affected: changed });
  } catch (err) {
    if (err instanceof Lockout) return fail(409, "authority.wouldLockOut");
    throw err;
  }
}

export async function DELETE(req: Request) {
  const g = await admin();
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, DeleteGroupGrant);
  if (!parsed.ok) return parsed.res;
  const { group } = parsed.data;

  try {
    const changed = await serializable(async (tx) => {
      await tx.groupRole.deleteMany({ where: { group } });
      await tx.groupResultUnit.deleteMany({ where: { group } });

      const affected = await reapplyGrants(tx);
      if (!(await someoneCanReachSettings(tx))) throw new Lockout();
      return affected;
    });

    return NextResponse.json({ affected: changed });
  } catch (err) {
    if (err instanceof Lockout) return fail(409, "authority.wouldLockOut");
    throw err;
  }
}
