// Assign / unassign a section card's holder. Admin only — the card→member
// registry is the source of truth for whose card purchases show up where.
import { prisma } from "@/lib/server/db";
import { canAccessSettings } from "@/lib/domain/permissions";
import { fail, gate } from "@/lib/api/guard";

const admin = () => gate(canAccessSettings, "auth.adminOnly");

// PATCH /api/cards/:id — body: { holderId: string | null }
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await admin();
  if (!g.ok) return g.res;

  const card = await prisma.card.findUnique({ where: { id } });
  if (!card) return fail(404, "card.notFound");

  // Empty / null → unassign; otherwise must be an existing user.
  const body = await req.json().catch(() => ({}));
  let holderId: string | null = null;
  if (typeof body.holderId === "string" && body.holderId !== "") {
    const user = await prisma.user.findUnique({ where: { id: body.holderId } });
    if (!user) return fail(422, "user.unknown");
    holderId = user.id;
  }

  await prisma.card.update({ where: { id }, data: { holderId } });
  return new Response(null, { status: 204 });
}

// DELETE /api/cards/:id — remove a card from the registry. Linked bank
// transactions keep their raw card number (cardLast4) but lose the card link
// (onDelete: SetNull). Admin only.
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await admin();
  if (!g.ok) return g.res;

  const card = await prisma.card.findUnique({ where: { id } });
  if (!card) return fail(404, "card.notFound");

  await prisma.card.delete({ where: { id } });
  return new Response(null, { status: 204 });
}
