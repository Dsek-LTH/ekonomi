// Fortnox's supplier register for the levfaktura export picker, read through the service connection (picking is not
// booking). Suppliers are added in Fortnox only. Every read is kept (lib/server/supplier-register.ts) for PDF matching
// and the bankgiro check before sending.
import { NextResponse } from "next/server";
import { listSuppliers } from "@/lib/fortnox";
import { canBookkeep } from "@/lib/domain/permissions";
import { fortnoxFailure, gateFortnoxService } from "@/lib/api/fortnox-route";
import { rememberRegister } from "@/lib/server/supplier-register";

// GET /api/fortnox/suppliers: every supplier, active ones first.
export async function GET() {
  const g = await gateFortnoxService(canBookkeep, "auth.bookkeeperExport");
  if (!g.ok) return g.res;
  try {
    const suppliers = await listSuppliers(g.token);
    suppliers.sort(
      (a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, "sv"),
    );
    // Best effort: a copy that could not be kept does not fail the picker.
    await rememberRegister(suppliers).catch((err) =>
      console.warn("[suppliers] could not keep register", err),
    );
    return NextResponse.json(suppliers);
  } catch (e) {
    return fortnoxFailure(e, { forbidden: "fortnox.missingSupplierScope" });
  }
}
