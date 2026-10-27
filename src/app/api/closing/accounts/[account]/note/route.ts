import { prisma } from "@/lib/server/db";
import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { AccountNoteBody } from "@/lib/api/schemas/closing";
import { canBookkeep } from "@/lib/domain/permissions";

// What an account is and how it is reconciled. Not tied to a year, so writing
// it once is enough until somebody has something to add. An empty body clears it.
export async function PUT(req: Request, ctx: { params: Promise<{ account: string }> }) {
  const g = await gate(canBookkeep);
  if (!g.ok) return g.res;
  const parsed = await parseBody(req, AccountNoteBody);
  if (!parsed.ok) return parsed.res;

  const { account } = await ctx.params;
  if (!/^\d{4}$/.test(account)) return fail(404, "closing.accountNotFound");

  const { body } = parsed.data;
  if (!body) {
    await prisma.accountNote.deleteMany({ where: { account } });
  } else {
    await prisma.accountNote.upsert({
      where: { account },
      create: { account, body, updatedById: g.actor.id },
      update: { body, updatedById: g.actor.id },
    });
  }
  return new Response(null, { status: 204 });
}
