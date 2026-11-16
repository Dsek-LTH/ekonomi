// Sending one board invoice to Fortnox again, from its row on the member's tab, with the customer, account, cost
// centre or date changed first when that is what Fortnox refused. Like the run, it looks in Fortnox first, so nothing is made
// twice.

import { NextResponse } from "next/server";
import { z } from "zod";
import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { Id, IsoDate, NonEmpty } from "@/lib/api/schemas/common";
import { canBookkeep } from "@/lib/domain/permissions";
import { FortnoxError } from "@/lib/fortnox";
import { userToken } from "@/lib/fortnox/export";
import { BoardInvoiceError, resendBoardInvoice } from "@/lib/server/board-invoices";
import { prisma } from "@/lib/server/db";

const Body = z.object({
  customerNumber: NonEmpty.optional(),
  account: NonEmpty.optional(),
  costCenterId: Id.nullable().optional(),
  invoiceDate: IsoDate.optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await gate(canBookkeep, "auth.bookkeeperExport");
  if (!g.ok) return g.res;
  const { id } = await ctx.params;

  const parsed = await parseBody(req, Body);
  if (!parsed.ok) return parsed.res;

  const { costCenterId } = parsed.data;
  if (costCenterId && !(await prisma.costCenter.findUnique({ where: { id: costCenterId } })))
    return fail(422, "board.costCenterNotFound");

  const auth = await userToken(g.actor.id);
  if (!auth.ok) return auth.res;

  try {
    const documentNumber = await resendBoardInvoice(id, g.actor.id, auth.token, parsed.data);
    if (!documentNumber) return fail(404, "board.invoiceNotFound");
    return NextResponse.json({ documentNumber });
  } catch (e) {
    console.error(`[board] resending invoice ${id} failed`, e);
    if (e instanceof BoardInvoiceError) return fail(422, e.code);
    if (e instanceof FortnoxError) return fail(502, e.message);
    throw e;
  }
}
