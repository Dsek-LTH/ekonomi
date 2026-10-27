import { prisma } from "@/lib/server/db";
import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { ReconcileAccountBody } from "@/lib/api/schemas/closing";
import { canBookkeep } from "@/lib/domain/permissions";

// "Avstämt i Fortnox": the reconciliation is done there, and this records that
// it was. PUT marks it (or rewrites the note), DELETE takes the mark away.

type Ctx = { params: Promise<{ year: string; account: string }> };

/** The year and account a URL names, if the ledger has a balance for them. */
async function resolve(ctx: Ctx) {
  const { year, account } = await ctx.params;
  const financialYear = Number(year);
  if (!Number.isInteger(financialYear) || !/^\d{4}$/.test(account)) return null;
  const balance = await prisma.ledgerAccountBalance.findUnique({
    where: { financialYear_account_costCenterCode: { financialYear, account, costCenterCode: "" } },
    select: { account: true },
  });
  return balance ? { financialYear, account } : null;
}

export async function PUT(req: Request, ctx: Ctx) {
  const g = await gate(canBookkeep);
  if (!g.ok) return g.res;
  const parsed = await parseBody(req, ReconcileAccountBody);
  if (!parsed.ok) return parsed.res;

  const key = await resolve(ctx);
  if (!key) return fail(404, "closing.accountNotFound");

  // Marking again moves the mark to now and to whoever did it: the account was
  // looked at again, and that is what the mark should say.
  await prisma.accountReconciliation.upsert({
    where: { financialYear_account: key },
    create: { ...key, reconciledById: g.actor.id, note: parsed.data.note },
    update: { reconciledAt: new Date(), reconciledById: g.actor.id, note: parsed.data.note },
  });
  return new Response(null, { status: 204 });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const g = await gate(canBookkeep);
  if (!g.ok) return g.res;

  const key = await resolve(ctx);
  if (!key) return fail(404, "closing.accountNotFound");

  await prisma.accountReconciliation.deleteMany({ where: key });
  return new Response(null, { status: 204 });
}
