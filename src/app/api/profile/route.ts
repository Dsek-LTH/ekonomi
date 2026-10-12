// The signed-in member's own profile: payout bank details for reimbursements.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { PatchProfile } from "@/lib/api/schemas/admin";

// PATCH /api/profile: update the current user's Swedish clearing + account
// number. An empty string clears a field.
export async function PATCH(req: Request) {
  const g = await gate();
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, PatchProfile);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;
  const data: { bankClearingNumber?: string | null; bankAccountNumber?: string | null } = {};
  if (body.bankClearingNumber !== undefined) data.bankClearingNumber = body.bankClearingNumber;
  if (body.bankAccountNumber !== undefined) data.bankAccountNumber = body.bankAccountNumber;

  const user = await prisma.user.update({
    where: { id: g.actor.id },
    data,
    select: { bankClearingNumber: true, bankAccountNumber: true },
  });
  return NextResponse.json(user);
}
