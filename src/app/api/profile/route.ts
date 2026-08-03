// The signed-in member's own profile: payout bank details for reimbursements.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { gate } from "@/lib/api/guard";

// PATCH /api/profile — update the current user's Swedish clearing + account
// number. An empty string clears a field.
export async function PATCH(req: Request) {
  const g = await gate();
  if (!g.ok) return g.res;

  const body = await req.json().catch(() => ({}));
  const clean = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const data: { bankClearingNumber?: string | null; bankAccountNumber?: string | null } = {};
  if ("bankClearingNumber" in body) data.bankClearingNumber = clean(body.bankClearingNumber);
  if ("bankAccountNumber" in body) data.bankAccountNumber = clean(body.bankAccountNumber);

  const user = await prisma.user.update({
    where: { id: g.actor.id },
    data,
    select: { bankClearingNumber: true, bankAccountNumber: true },
  });
  return NextResponse.json({ ok: true, ...user });
}
