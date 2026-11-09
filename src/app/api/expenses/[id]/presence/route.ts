// PUT: heartbeat of the booking or review screen, answered with who else is here and the current version.
// DELETE: goodbye (?screen=review names the review screen). Advisory, never a lock (lib/domain/presence.ts).
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
  // Same gate as the booking screen; bokföring after the review is the same authority.
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

  const { active, screen } = parsed.data;
  await heartbeat(id, g.actor.id, screen, active);
  const others = await othersOn(id, g.actor.id, screen);

  const answer: PresenceAnswer = {
    others,
    updatedAt: expense.updatedAt.toISOString(),
    status: expense.status,
    updatedBy:
      (expense.exportClaimState ? expense.exportClaimedBy : expense.events[0]?.actor) ?? undefined,
  };
  return NextResponse.json(answer);
}

// Sent with `keepalive` on unmount so the name leaves at once. Not gated on canBookkeep:
// a bookkeeper who lost the role should not be stuck on a screen.
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate();
  if (!g.ok) return g.res;

  const screen = new URL(req.url).searchParams.get("screen") === "review" ? "review" : "book";
  await leave(id, g.actor.id, screen);
  return new Response(null, { status: 204 });
}
