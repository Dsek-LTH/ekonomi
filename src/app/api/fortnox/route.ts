// Fortnox connection status (GET) and disconnect (DELETE).
import { NextResponse } from "next/server";
import { canAccessSettings } from "@/lib/domain/permissions";
import { disconnect, fortnoxConfigured, getConnection } from "@/lib/fortnox";
import { gate } from "@/lib/api/guard";

export async function GET() {
  const g = await gate();
  if (!g.ok) return g.res;

  const conn = await getConnection();
  return NextResponse.json({
    configured: fortnoxConfigured(),
    connected: Boolean(conn),
    companyName: conn?.companyName ?? null,
    voucherSeries: conn?.voucherSeries ?? null,
    expiresAt: conn?.expiresAt?.toISOString() ?? null,
  });
}

export async function DELETE() {
  const g = await gate(canAccessSettings, "auth.adminDisconnectFortnox");
  if (!g.ok) return g.res;

  await disconnect();
  return new Response(null, { status: 204 });
}
