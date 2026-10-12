// Rename, retire or delete a LOCAL cost centre. Fortnox-owned ones are managed
// in Fortnox and re-synced, so they are read-only here.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { canAccessSettings } from "@/lib/domain/permissions";
import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { PatchCostCenter } from "@/lib/api/schemas/admin";
import type { CostCenter } from "@/lib/generated/prisma/client";

const admin = () => gate(canAccessSettings, "auth.adminEditCostCenter");

// The row, if it is one this app owns. Same `{ ok }` shape as the gate, so the
// caller reads it the same way, and gets a `cc` that is actually there.
type Local = { ok: true; cc: CostCenter } | { ok: false; res: NextResponse };

async function loadLocal(id: string): Promise<Local> {
  const cc = await prisma.costCenter.findUnique({ where: { id } });
  if (!cc) return { ok: false, res: fail(404, "costCenter.notFound") };
  if (cc.source !== "LOCAL") {
    return { ok: false, res: fail(409, "costCenter.fortnoxOwned", { values: { code: cc.code } }) };
  }
  return { ok: true, cc };
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await admin();
  if (!g.ok) return g.res;
  const { id } = await ctx.params;
  const local = await loadLocal(id);
  if (!local.ok) return local.res;

  const parsed = await parseBody(req, PatchCostCenter);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;
  const data: { name?: string; active?: boolean } = {};
  if (body.name !== undefined) data.name = body.name;
  // The code is left alone on purpose: allocations and voucher lines point at
  // this row, and the result unit that attests them is derived from the code.
  if (body.active !== undefined) data.active = body.active;
  // A PATCH that names nothing this route acts on is a malformed request, not
  // a quiet success. The same answer PATCH /api/budgets/[id] gives.
  if (Object.keys(data).length === 0) return fail(422, "request.nothingToChange");

  await prisma.costCenter.update({ where: { id: local.cc.id }, data });
  return new Response(null, { status: 204 });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await admin();
  if (!g.ok) return g.res;
  const { id } = await ctx.params;
  const local = await loadLocal(id);
  if (!local.ok) return local.res;
  const { cc } = local;

  // Anything already booked against it has to keep resolving, so a cost centre
  // in use is retired rather than deleted, the same end state as a Fortnox one
  // that gets deactivated.
  const [allocations, lines, budgets] = await Promise.all([
    prisma.expenseCostAllocation.count({ where: { costCenterId: cc.id } }),
    prisma.verificationLine.count({ where: { costCenterId: cc.id } }),
    prisma.budgetCostCenter.count({ where: { costCenterId: cc.id } }),
  ]);
  const used = allocations + lines + budgets;
  if (used > 0) {
    if (!cc.active) {
      return fail(409, "costCenter.inUse", { values: { code: cc.code, count: used } });
    }
    await prisma.costCenter.update({ where: { id: cc.id }, data: { active: false } });
    return NextResponse.json({ retired: true, used });
  }

  await prisma.costCenter.delete({ where: { id: cc.id } });
  return NextResponse.json({ retired: false });
}
