// What is free over a period, read by the rental form as dates are typed. The create route checks again server-side.
import { canManageRentals } from "@/lib/domain/permissions";
import { fail, gate } from "@/lib/api/guard";
import { getAvailability } from "@/lib/data/rental-availability";
import { isCompleteDate } from "@/lib/domain/date";

// GET /api/rental-items/availability?from=YYYY-MM-DD&to=YYYY-MM-DD&exclude=<contractId>
export async function GET(req: Request) {
  const g = await gate(canManageRentals, "contract.noManageAccess");
  if (!g.ok) return g.res;

  const url = new URL(req.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  // Whole days only: a half-typed date would be read as 1 January of something.
  if (!isCompleteDate(from) || !isCompleteDate(to)) return fail(400, "request.invalidBody");
  if (to < from) return fail(422, "contract.returnBeforePickup");

  // The contract being amended, so its own lines do not count as taken.
  const exclude = url.searchParams.get("exclude") ?? undefined;

  return Response.json(await getAvailability({ from, to }, exclude));
}
