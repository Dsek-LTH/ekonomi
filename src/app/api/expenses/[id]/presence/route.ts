// The booking screen's heartbeat (PUT) and goodbye (DELETE). [id] = expense id.
//
// The heartbeat says "I am still here", or, once its user has gone idle, "I am
// not", and is answered with who else is here and the utlägg's current version.
// That answer is how a screen learns that a colleague saved while it was open.
//
// Presence is advisory and never a lock. See lib/domain/presence.ts.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { canBookkeep } from "@/lib/domain/permissions";
import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { PresenceHeartbeat } from "@/lib/api/schemas/expense";
import { heartbeat, leave, othersOn } from "@/lib/server/presence";
import type { PresenceAnswer } from "@/lib/domain/presence";

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  // The same gate as the booking screen itself: only somebody who could book
  // it has any business announcing that they are.
  const g = await gate(canBookkeep, "auth.bookkeeperBook");
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, PresenceHeartbeat);
  if (!parsed.ok) return parsed.res;

  const expense = await prisma.expense.findUnique({
    where: { id },
    select: {
      updatedAt: true,
      status: true,
      // Taking the export lock moves the version on without an event of its
      // own, so the one exporting is who changed it, when there is one.
      exportClaimState: true,
      exportClaimedBy: { select: { id: true, name: true } },
      events: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { actor: { select: { id: true, name: true } } },
      },
    },
  });
  if (!expense) return fail(404, "expense.notFound");

  await heartbeat(id, g.actor.id, parsed.data.active);
  const others = await othersOn(id, g.actor.id);

  const answer: PresenceAnswer = {
    others,
    updatedAt: expense.updatedAt.toISOString(),
    status: expense.status,
    updatedBy:
      (expense.exportClaimState ? expense.exportClaimedBy : expense.events[0]?.actor) ?? undefined,
  };
  return NextResponse.json(answer);
}

// Sent with `keepalive` as the screen unmounts or the tab goes away, so the
// name leaves a colleague's screen at once rather than when the TTL runs out.
// Not gated on canBookkeep: anybody may take themselves off a screen, and a
// bookkeeper who just lost the role should not be left on it for 30 seconds.
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate();
  if (!g.ok) return g.res;

  await leave(id, g.actor.id);
  return new Response(null, { status: 204 });
}
