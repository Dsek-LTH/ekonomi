// Draw the uthyrningsavtal for a form nobody has saved.
//
// The rental form shows this in the panel beside it and redraws as the answers
// change, so the person filling one in is looking at the contract itself rather
// than at a form that promises one. It writes nothing and reads one row, the
// signatory's, so there is no draft left behind by opening the page and walking
// away.
//
// POST rather than GET, because the whole form is the input and a half-filled
// contract does not belong in a URL, a proxy log or a browser's history. The
// bytes come back uncached for the same reason the stored document's do: this
// page names people who are not members.
import { prisma } from "@/lib/server/db";
import { canManageRentals } from "@/lib/domain/permissions";
import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { PreviewRental } from "@/lib/api/schemas/contract";
import { rentalTitle, signatoryTitle } from "@/lib/contract/signatory";
import { renderRentalPreview } from "@/lib/contract/document";
import { isoToDate } from "@/lib/domain/date";
import type { RentalDraft } from "@/lib/contract/document";

/** Nothing typed yet is nothing to print, not an empty string on the page. */
const orNull = (v: string): string | null => (v.trim() === "" ? null : v.trim());

// POST /api/contracts/rental/preview
export async function POST(req: Request) {
  const g = await gate(canManageRentals, "contract.noManageAccess");
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, PreviewRental);
  if (!parsed.ok) return parsed.res;
  const d = parsed.data;

  // The signatory's name and the post they sign under, exactly as the create
  // route reads them, so the preview's signature block is the one the contract
  // will carry rather than a guess at it. Unknown or unnamed leaves the block
  // ruled with a dash under it, which is also what a real draft looks like
  // before anybody has been picked.
  //
  // No capability check here, unlike the create route. This draws a picture; it
  // does not bind the section to anything, and refusing to *show* somebody what
  // a contract would look like with the wrong name on it would be a rule
  // enforced against a preview instead of against the act.
  const signatory = d.sectionSignatoryId
    ? await prisma.user.findUnique({
        where: { id: d.sectionSignatoryId },
        select: { name: true, roles: true },
      })
    : null;

  const renter = d.counterpartySignatory;
  const draft: RentalDraft = {
    // Derived exactly as the create route derives it, so the title on the
    // preview is the title the contract gets. See lib/contract/signatory.ts.
    title: rentalTitle(d.counterparty),
    counterparty: d.counterparty,
    counterpartyOrgNo: orNull(d.counterpartyOrgNo),
    counterpartyAddress: orNull(d.counterpartyAddress),
    counterpartyPostalCode: orNull(d.counterpartyPostalCode),
    counterpartyCity: orNull(d.counterpartyCity),
    pickupAt: isoToDate(d.pickupAt),
    returnAt: isoToDate(d.returnAt),
    purpose: orNull(d.purpose),
    place: orNull(d.place),
    paymentDueAt: isoToDate(d.paymentDueAt),
    // Rows that are still empty are left off. A blank line in the table reads
    // as a mistake in the contract rather than as a row not filled in yet.
    lines: d.lines
      .filter((l) => l.description.trim() !== "")
      .map((l) => ({
        description: l.description.trim(),
        quantity: l.quantity,
        unitPriceOre: l.unitPriceOre,
        discountPercent: l.discountPercent,
        replacementValueOre: l.replacementValueOre,
      })),
    parties: [
      ...(signatory
        ? [
            {
              role: "SECTION" as const,
              name: signatory.name,
              title: signatoryTitle(signatory.roles),
              orgName: null,
              orgNo: null,
              email: null,
              phone: null,
            },
          ]
        : []),
      ...(renter && renter.name.trim() !== ""
        ? [
            {
              role: "COUNTERPARTY" as const,
              name: renter.name.trim(),
              title: null,
              orgName: orNull(d.counterparty),
              orgNo: null,
              email: orNull(renter.email),
              phone: orNull(renter.phone),
            },
          ]
        : []),
    ],
  };

  const drawn = await renderRentalPreview(draft);
  if (!drawn.ok) return fail(502, "contract.renderFailed");

  return new Response(new Uint8Array(drawn.bytes), {
    headers: {
      "Content-Type": "application/pdf",
      // Names people who are not members, and describes an agreement that does
      // not exist. Never kept anywhere.
      "Cache-Control": "private, max-age=0, no-store",
      "Content-Disposition": `inline; filename="${drawn.filename}"`,
    },
  });
}
