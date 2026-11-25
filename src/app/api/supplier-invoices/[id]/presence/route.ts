// PUT: heartbeat of the kontering, answered with who else is on it and the invoice's current version.
// DELETE: goodbye. Advisory, never a lock: the save itself is guarded by expectedUpdatedAt (../route.ts).
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { canBookkeep } from "@/lib/domain/permissions";
import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { PresenceHeartbeat } from "@/lib/api/schemas/expense";
import { invoiceHeartbeat, leaveInvoice, othersOnInvoice } from "@/lib/server/presence";
import type { PresenceAnswer } from "@/lib/domain/presence";

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  // Same gate as the kontering page.
  const g = await gate(canBookkeep, "auth.bookkeeperBook");
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, PresenceHeartbeat);
  if (!parsed.ok) return parsed.res;

  const invoice = await prisma.supplierInvoice.findUnique({
    where: { id },
    select: {
      updatedAt: true,
      status: true,
      events: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { actor: { select: { id: true, name: true } } },
      },
    },
  });
  if (!invoice) return fail(404, "supplierInvoice.notFound");

  await invoiceHeartbeat(id, g.actor.id, parsed.data.active);
  const others = await othersOnInvoice(id, g.actor.id);

  const answer: PresenceAnswer = {
    others,
    updatedAt: invoice.updatedAt.toISOString(),
    status: invoice.status,
    updatedBy: invoice.events[0]?.actor ?? undefined,
  };
  return NextResponse.json(answer);
}

// Sent with `keepalive` on unmount so the name leaves at once. Not gated on canBookkeep, as for the utlägg.
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate();
  if (!g.ok) return g.res;
  await leaveInvoice(id, g.actor.id);
  return new Response(null, { status: 204 });
}
