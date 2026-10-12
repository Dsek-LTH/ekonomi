// What is free over a period.
//
// Read by the rental form as the dates are typed, so the person drawing a
// contract sees "0 av 1 ledig" beside the Soundboks before they promise it,
// rather than after they submit. The create route checks the same thing again
// server-side, because this answer is a moment old by the time a form is sent.
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
  // Whole days only. A half-typed date would otherwise be read by `new Date` as
  // 1 January of something and answer a question nobody asked.
  if (!isCompleteDate(from) || !isCompleteDate(to)) return fail(400, "request.invalidBody");
  if (to < from) return fail(422, "contract.returnBeforePickup");

  // The contract being amended, so its own lines do not report the gear as
  // taken by itself.
  const exclude = url.searchParams.get("exclude") ?? undefined;

  return Response.json(await getAvailability({ from, to }, exclude));
}
