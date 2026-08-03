// Create a section card manually. Cards are normally auto-created on bank
// import, but an admin may want to register one ahead of time (e.g. to assign a
// holder before the first import). Admin only.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { canAccessSettings } from "@/lib/domain/permissions";
import { fail, gate } from "@/lib/api/guard";

// POST /api/cards — body: { last4: string, holderId?: string | null }
export async function POST(req: Request) {
  const g = await gate(canAccessSettings, "auth.adminOnly");
  if (!g.ok) return g.res;

  const body = await req.json().catch(() => ({}));
  const last4 = String(body.last4 ?? "").trim();
  if (!/^\d{4}$/.test(last4)) {
    return fail(422, "card.last4Required");
  }

  const existing = await prisma.card.findUnique({ where: { last4 } });
  if (existing) return fail(409, "card.exists", { values: { last4 } });

  // Optional holder — must be an existing user if provided.
  let holderId: string | null = null;
  if (typeof body.holderId === "string" && body.holderId !== "") {
    const user = await prisma.user.findUnique({ where: { id: body.holderId } });
    if (!user) return fail(422, "user.unknown");
    holderId = user.id;
  }

  const card = await prisma.card.create({ data: { last4, holderId } });
  return NextResponse.json({ ok: true, id: card.id }, { status: 201 });
}
