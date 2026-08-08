// Create a section card manually. Cards are normally auto-created on bank
// import, but an admin may want to register one ahead of time (e.g. to assign a
// holder before the first import). Admin only.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { canAccessSettings } from "@/lib/domain/permissions";
import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { CreateCard } from "@/lib/api/schemas/admin";

// POST /api/cards — body: { last4: string, holderId?: string | null }
export async function POST(req: Request) {
  const g = await gate(canAccessSettings, "auth.adminOnly");
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, CreateCard);
  if (!parsed.ok) return parsed.res;
  const { last4 } = parsed.data;

  const existing = await prisma.card.findUnique({ where: { last4 } });
  if (existing) return fail(409, "card.exists", { values: { last4 } });

  // Optional holder — must be an existing user if provided.
  let holderId: string | null = null;
  if (parsed.data.holderId) {
    const user = await prisma.user.findUnique({ where: { id: parsed.data.holderId } });
    if (!user) return fail(422, "user.unknown");
    holderId = user.id;
  }

  const card = await prisma.card.create({ data: { last4, holderId } });
  return NextResponse.json({ id: card.id }, { status: 201 });
}
