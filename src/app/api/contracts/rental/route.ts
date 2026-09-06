// Draw an uthyrningsavtal.
//
// One call rather than the draft-then-fill flow the expense wizard uses. An
// utlägg has to exist before a receipt can be attached to it, which is what
// forces that shape; a rental has nothing to attach until it is complete, so
// there is no reason to leave half-finished contracts behind every time
// somebody opens the form and walks away.
//
// Everything lands in one transaction: the contract, its rental half, its
// lines and the two parties. The document is drawn *after* it commits, because
// a typesetter is not something to hold a database transaction open across, and
// a contract whose PDF failed to draw is still a contract that the screen can
// redraw. The reverse, a PDF in the bucket with no row behind it, is not
// recoverable from anywhere.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { canManageContracts } from "@/lib/domain/permissions";
import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { CreateRental } from "@/lib/api/schemas/contract";
import { normaliseTags } from "@/lib/contract/tags";
import { storeContractDocument } from "@/lib/contract/document";
import { isoToDate } from "@/lib/domain/date";

// POST /api/contracts/rental
export async function POST(req: Request) {
  const g = await gate(canManageContracts, "contract.noManageAccess");
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, CreateRental);
  if (!parsed.ok) return parsed.res;
  const d = parsed.data;

  // A period that ends before it starts is not a rental anybody meant. Checked
  // as ISO days, which sort lexically, so no timezone is involved.
  if (d.returnAt < d.pickupAt) return fail(422, "contract.returnBeforePickup");

  // The section's signatory is whoever is drawing the contract. Their name is
  // copied onto the party row rather than read through the relation, because
  // the document states who signed it on the day, and a name can change.
  const actor = await prisma.user.findUnique({
    where: { id: g.actor.id },
    select: { id: true, name: true },
  });
  if (!actor) return fail(401, "auth.signedOut");

  // Catalogue ids are checked before anything is written. An id that names no
  // item would otherwise be silently dropped by the SetNull relation, and the
  // line would lose the only trail back to what it was drawn from.
  const itemIds = [
    ...new Set(d.lines.map((l) => l.itemId).filter((v): v is string => Boolean(v))),
  ];
  if (itemIds.length > 0) {
    const known = await prisma.rentalItem.count({ where: { id: { in: itemIds } } });
    if (known !== itemIds.length) return fail(422, "contract.itemNotFound");
  }

  const contract = await prisma.contract.create({
    data: {
      kind: "RENTAL",
      status: "DRAFT",
      title: d.title,
      counterparty: d.counterparty,
      counterpartyOrgNo: d.counterpartyOrgNo ?? null,
      tags: normaliseTags(d.tags),
      notes: d.notes ?? null,
      createdById: actor.id,

      // Copied from the rental period, so that one expiry query serves every
      // kind of contract in the archive and the list does not have to know
      // which of them keep their dates somewhere else.
      validFrom: isoToDate(d.pickupAt),
      validTo: isoToDate(d.returnAt),

      rental: {
        create: {
          pickupAt: isoToDate(d.pickupAt)!,
          returnAt: isoToDate(d.returnAt)!,
          purpose: d.purpose ?? null,
          place: d.place ?? null,
          priceOre: d.priceOre,
          depositOre: d.depositOre,
          lines: {
            create: d.lines.map((l, i) => ({
              itemId: l.itemId ?? null,
              description: l.description,
              quantity: l.quantity,
              unitPriceOre: l.unitPriceOre,
              replacementValueOre: l.replacementValueOre,
              // The order they were typed in. Not appended through
              // lib/server/sort-order.ts: these are created together in one
              // statement, so there is no second writer to race with.
              sortOrder: i,
            })),
          },
        },
      },

      parties: {
        create: [
          {
            role: "SECTION",
            name: actor.name,
            title: d.sectionSignatoryTitle ?? null,
            userId: actor.id,
          },
          ...(d.counterpartySignatory
            ? [
                {
                  role: "COUNTERPARTY" as const,
                  name: d.counterpartySignatory.name,
                  email: d.counterpartySignatory.email ?? null,
                  phone: d.counterpartySignatory.phone ?? null,
                  title: d.counterpartySignatory.title ?? null,
                  orgName: d.counterparty,
                },
              ]
            : []),
        ],
      },
    },
    select: { id: true },
  });

  // Outside the transaction, and a failure here is reported rather than raised:
  // the contract exists, the screen it lands on offers "rita om dokumentet",
  // and telling somebody their contract was not created when it was is the
  // worse of the two wrong answers.
  const drawn = await storeContractDocument(contract.id, actor.id);
  if (!drawn.ok) {
    console.error(`[contracts] ${contract.id}: drawn document failed`, drawn);
    return NextResponse.json({ id: contract.id, documentDrawn: false }, { status: 201 });
  }

  return NextResponse.json({ id: contract.id, documentDrawn: true }, { status: 201 });
}
