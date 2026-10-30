// POST /api/fortnox/suppliers/sync: fetch the supplier register again, from
// the Fortnox settings page. The nightly sync does the same.
import { NextResponse } from "next/server";
import { canAccessSettings } from "@/lib/domain/permissions";
import { syncSuppliers } from "@/lib/fortnox/sync";
import { fortnoxFailure, gateFortnoxService } from "@/lib/api/fortnox-route";

export async function POST() {
  const g = await gateFortnoxService(canAccessSettings, "auth.adminSyncChart");
  if (!g.ok) return g.res;
  try {
    return NextResponse.json(await syncSuppliers(g.token));
  } catch (e) {
    return fortnoxFailure(e, { forbidden: "fortnox.missingSupplierScope" });
  }
}
