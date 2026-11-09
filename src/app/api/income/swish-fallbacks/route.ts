// Swish amount fallbacks: what to assume when a payment's message says nothing usable. Keyed by amount, so an upsert.
import { NextResponse } from "next/server";

import { gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { UpsertSwishFallback } from "@/lib/api/schemas/income";
import { canAccessSettings } from "@/lib/domain/permissions";
import { prisma } from "@/lib/server/db";

export async function POST(req: Request) {
  const g = await gate(canAccessSettings, "auth.adminOnly");
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, UpsertSwishFallback);
  if (!parsed.ok) return parsed.res;
  const { amount, message } = parsed.data;

  // One guess per amount (the primary key). Re-posting replaces the message.
  await prisma.swishAmountFallback.upsert({
    where: { amount },
    create: { amount, message },
    update: { message },
  });

  return NextResponse.json({ amount }, { status: 201 });
}
