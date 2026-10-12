// POST /api/users/[id]/test-email: send one member a test mail.
//
// For checking, in production, that mail reaches somebody and looks right
// there: a mail of the chosen kind built from their real data, "[Test]" in the
// subject, sent through the outbox like any other. It shows up in the log
// marked with who sent it. See lib/server/test-email.ts.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { canAccessSettings } from "@/lib/domain/permissions";
import { deliverSoon } from "@/lib/server/notify";
import { sendTestEmail } from "@/lib/server/test-email";
import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { SendTestEmail } from "@/lib/api/schemas/admin";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await gate(canAccessSettings, "auth.adminOnly");
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, SendTestEmail);
  if (!parsed.ok) return parsed.res;

  const { id } = await ctx.params;
  const recipient = await prisma.user.findUnique({
    where: { id },
    select: { id: true, name: true },
  });
  if (!recipient) return fail(404, "user.notFound");

  const result = await sendTestEmail(parsed.data.kind, recipient, g.actor);
  // Nothing real to build it from: no utlägg, no card transactions, or a
  // digest with nothing in it, which would not be sent either.
  if (!result.ok) return fail(409, `email.${result.error}`, { values: { name: recipient.name } });
  deliverSoon();
  return NextResponse.json({ id: result.id, subject: result.subject }, { status: 201 });
}
