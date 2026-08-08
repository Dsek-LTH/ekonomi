// Sync the selectable cost centres from Fortnox (active ones become selectable).
import { NextResponse } from "next/server";
import { canAccessSettings } from "@/lib/domain/permissions";
import { syncCostCenters } from "@/lib/fortnox/sync";
import { fortnoxFailure, gateFortnoxService } from "@/lib/api/fortnox-route";

export async function POST() {
  const g = await gateFortnoxService(
    canAccessSettings,
    "auth.adminSyncCostCenters",
  );
  if (!g.ok) return g.res;

  try {
    return NextResponse.json(await syncCostCenters(g.token));
  } catch (e) {
    return fortnoxFailure(e, {
      forbidden: "fortnox.missingCostCenterScope",
      fallback: "fortnox.syncFailed",
    });
  }
}
