// Fortnox's supplier register, for the levfaktura export picker: read it, or
// add a supplier the section has not bought from before.
//
// Through the treasurer's own login, like the export it serves, so both need
// the same thing to work and a missing scope surfaces here first.
//
// Every read is also kept (lib/server/supplier-register.ts), which is what a
// levfaktura's PDF is matched against at the fördelning, and what its record
// checks the bankgiro against before it is sent.
import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupplier, listSuppliers } from "@/lib/fortnox";
import { userToken } from "@/lib/fortnox/export";
import { canBookkeep } from "@/lib/domain/permissions";
import { gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { Clearable, Trimmed } from "@/lib/api/schemas/common";
import { fortnoxFailure } from "@/lib/api/fortnox-route";
import { rememberRegister, rememberSupplier } from "@/lib/server/supplier-register";

// GET /api/fortnox/suppliers: every supplier, active ones first.
export async function GET() {
  const g = await gate(canBookkeep, "auth.bookkeeperExport");
  if (!g.ok) return g.res;
  const auth = await userToken(g.actor.id);
  if (!auth.ok) return auth.res;
  try {
    const suppliers = await listSuppliers(auth.token);
    suppliers.sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, "sv"));
    // Best effort: a copy that could not be kept does not fail the picker.
    await rememberRegister(suppliers).catch((err) => console.warn("[suppliers] could not keep register", err));
    return NextResponse.json(suppliers);
  } catch (e) {
    return fortnoxFailure(e, { forbidden: "fortnox.missingScopeLogin" });
  }
}

const NewSupplier = z.object({
  name: Trimmed.min(1).max(100),
  orgNo: Clearable(Trimmed.max(20)).optional(),
  bankgiro: Clearable(Trimmed.max(20)).optional(),
  plusgiro: Clearable(Trimmed.max(20)).optional(),
});

// POST /api/fortnox/suppliers: add one, as the invoice describes it.
export async function POST(req: Request) {
  const g = await gate(canBookkeep, "auth.bookkeeperExport");
  if (!g.ok) return g.res;
  const parsed = await parseBody(req, NewSupplier);
  if (!parsed.ok) return parsed.res;
  const auth = await userToken(g.actor.id);
  if (!auth.ok) return auth.res;
  try {
    const created = await createSupplier(auth.token, parsed.data);
    await rememberSupplier(created).catch((err) => console.warn("[suppliers] could not keep supplier", err));
    return NextResponse.json(created, { status: 201 });
  } catch (e) {
    return fortnoxFailure(e, { forbidden: "fortnox.missingScopeLogin" });
  }
}
