// Settle an export whose outcome was not known: the treasurer has looked in
// Fortnox and says whether the supplier invoice was made.
//
//   { outcome: "not_created" }                      let the lock go, to try again
//   { outcome: "created", givenNumber: "123" }      record it as exported
//
// Only for an export marked UNCERTAIN. One still CLAIMED or SENT is an export
// that is running, and is not anybody's to settle.
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { canBookkeep } from "@/lib/domain/permissions";
import { fail, gate } from "@/lib/api/guard";
import { applied, commit } from "@/lib/api/stale-write";
import { parseBody } from "@/lib/api/parse";
import { Trimmed } from "@/lib/api/schemas/common";
import { loadInvoiceFor } from "@/lib/api/supplier-invoice-access";

const ReleaseBody = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("not_created") }),
  z.object({ outcome: z.literal("created"), givenNumber: Trimmed.regex(/^\d{1,10}$/) }),
]);

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate(canBookkeep, "auth.bookkeeperExport");
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, ReleaseBody);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;

  const access = await loadInvoiceFor(g.actor, id);
  if (!access.ok) return access.res;
  const { invoice } = access;
  if (invoice.exportClaimState !== "UNCERTAIN") return fail(409, "supplierInvoice.nothingToRelease");

  const where = { id: invoice.id, exportClaimState: "UNCERTAIN" as const, exportClaimedAt: invoice.exportClaimedAt };
  const cleared = { exportClaimedAt: null, exportClaimedById: null, exportClaimState: null };

  const result = await commit(() =>
    prisma.$transaction(async (tx) => {
      if (body.outcome === "not_created") {
        applied(await tx.supplierInvoice.updateMany({ where, data: cleared }), "supplierInvoice.changedMeanwhile");
        await tx.supplierInvoiceEvent.create({
          data: { invoiceId: invoice.id, type: "EXPORT_RELEASED", actorId: g.actor.id },
        });
        return "BOOKED" as const;
      }
      applied(
        await tx.supplierInvoice.updateMany({
          where,
          data: {
            ...cleared,
            status: "EXPORTED",
            fortnoxGivenNumber: body.givenNumber,
            exportedAt: new Date(),
            exportedById: g.actor.id,
          },
        }),
        "supplierInvoice.changedMeanwhile",
      );
      await tx.supplierInvoiceEvent.create({
        data: { invoiceId: invoice.id, type: "EXPORTED", actorId: g.actor.id, comment: body.givenNumber },
      });
      return "EXPORTED" as const;
    }),
  );
  if (result instanceof NextResponse) return result;
  return NextResponse.json({ id: invoice.id, status: result });
}
