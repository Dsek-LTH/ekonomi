// Fortnox's supplier register, for the levfaktura export picker.
//
// Read through the service connection, like every other register: picking a
// supplier is not booking, and needs nobody's own Fortnox login. Suppliers are
// added in Fortnox itself, never from here, and show up on the next read.
//
// Every read is also kept (lib/server/supplier-register.ts), which is what a
// levfaktura's PDF is matched against at the fördelning, and what its record
// checks the bankgiro against before it is sent. The nightly sync keeps it
// current between reads.
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
    suppliers.sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, "sv"));
    // Best effort: a copy that could not be kept does not fail the picker.
    await rememberRegister(suppliers).catch((err) => console.warn("[suppliers] could not keep register", err));
    return NextResponse.json(suppliers);
  } catch (e) {
    return fortnoxFailure(e, { forbidden: "fortnox.missingSupplierScope" });
  }
}
