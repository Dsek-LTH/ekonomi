// The board's year-end invoices. GET is what the button would do, per member. POST does it: one customer
// invoice per member in Fortnox, as an utkast, written with the bookkeeper's own login, to the Fortnox customer
// picked for each.

import { NextResponse } from "next/server";
import { z } from "zod";
import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { Id, NonEmpty } from "@/lib/api/schemas/common";
import { canBookkeep, canViewBookkeeping } from "@/lib/domain/permissions";
import { userToken } from "@/lib/fortnox/export";
import { previewBoardInvoices, runBoardInvoices } from "@/lib/server/board-invoices";
import { getFiscalYear } from "@/lib/server/fiscal-year";

export const maxDuration = 300;

export async function GET() {
  const g = await gate(canViewBookkeeping, "auth.denied");
  if (!g.ok) return g.res;
  // The year picked in the header, like every other dated list.
  const year = await getFiscalYear();
  if (!year) return fail(409, "board.noFiscalYear");
  return NextResponse.json({ year, members: await previewBoardInvoices(year) });
}

/** `memberIds` narrows the run to some members: "Fakturera nu" for somebody who is leaving the board. */
const Body = z.object({
  memberIds: z.array(Id).min(1).max(200).optional(),
  /** Fortnox customer number per member id. Customers are added in Fortnox, never here. */
  customers: z.record(Id, NonEmpty).default({}),
});

export async function POST(req: Request) {
  const g = await gate(canBookkeep, "auth.bookkeeperExport");
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, Body);
  if (!parsed.ok) return parsed.res;

  const year = await getFiscalYear();
  if (!year) return fail(409, "board.noFiscalYear");

  const auth = await userToken(g.actor.id);
  if (!auth.ok) return auth.res;

  const result = await runBoardInvoices(
    year,
    g.actor.id,
    auth.token,
    parsed.data.customers,
    parsed.data.memberIds,
  );
  if ("error" in result) return fail(409, result.error);
  return NextResponse.json(result);
}
