// A member's bank details for the treasury, gated on `canBookkeep` (the capability that already shows them on the booking screen).
import { NextResponse } from "next/server";
import { canBookkeep } from "@/lib/domain/permissions";
import { getPayoutAccount } from "@/lib/data/users";
import { gate } from "@/lib/api/guard";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await gate(canBookkeep, "auth.bookkeeperViewPayout");
  if (!g.ok) return g.res;

  const { id } = await ctx.params;
  return NextResponse.json(await getPayoutAccount(id));
}
