// Fortnox's customer register for picking who a board invoice goes to, read through the service connection.
// Customers are added in Fortnox only.
import { NextResponse } from "next/server";
import { listCustomers } from "@/lib/fortnox";
import { canBookkeep } from "@/lib/domain/permissions";
import { fortnoxFailure, gateFortnoxService } from "@/lib/api/fortnox-route";

// GET /api/fortnox/customers: every customer, active ones first.
export async function GET() {
  const g = await gateFortnoxService(canBookkeep, "auth.bookkeeperExport");
  if (!g.ok) return g.res;
  try {
    const customers = await listCustomers(g.token);
    customers.sort(
      (a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, "sv"),
    );
    return NextResponse.json(customers);
  } catch (e) {
    return fortnoxFailure(e, { forbidden: "fortnox.missingCustomerScope" });
  }
}
