// Draws the rental form's contract for the preview panel and writes nothing. POST because the whole form is input. Uncached: names non-members.
import { canManageRentals } from "@/lib/domain/permissions";
import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { PreviewRental } from "@/lib/api/schemas/contract";
import { rentalTitle } from "@/lib/contract/signatory";
import { renderRentalPreview } from "@/lib/contract/document";
import { isoToDate } from "@/lib/domain/date";
import type { RentalDraft } from "@/lib/contract/document";

const orNull = (v: string): string | null => (v.trim() === "" ? null : v.trim());

// POST /api/contracts/rental/preview
export async function POST(req: Request) {
  const g = await gate(canManageRentals, "contract.noManageAccess");
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, PreviewRental);
  if (!parsed.ok) return parsed.res;
  const d = parsed.data;

  const draft: RentalDraft = {
    // Derived as the create route does (lib/contract/signatory.ts).
    title: rentalTitle(d.counterparty),
    counterparty: d.counterparty,
    counterpartyOrgNo: orNull(d.counterpartyOrgNo),
    counterpartyAddress: orNull(d.counterpartyAddress),
    counterpartyPostalCode: orNull(d.counterpartyPostalCode),
    counterpartyCity: orNull(d.counterpartyCity),
    counterpartyEmail: orNull(d.counterpartyEmail),
    counterpartyPhone: orNull(d.counterpartyPhone),
    pickupAt: isoToDate(d.pickupAt),
    returnAt: isoToDate(d.returnAt),
    purpose: orNull(d.purpose),
    signatureCount: d.signatureCount,
    // Empty rows are left off.
    lines: d.lines
      .filter((l) => l.description.trim() !== "")
      .map((l) => ({
        description: l.description.trim(),
        quantity: l.quantity,
        unitPriceOre: l.unitPriceOre,
        discountPercent: l.discountPercent,
        replacementValueOre: l.replacementValueOre,
      })),
  };

  const drawn = await renderRentalPreview(draft);
  if (!drawn.ok) return fail(502, "contract.renderFailed");

  return new Response(new Uint8Array(drawn.bytes), {
    headers: {
      "Content-Type": "application/pdf",
      // Names non-members: never kept anywhere.
      "Cache-Control": "private, max-age=0, no-store",
      "Content-Disposition": `inline; filename="${drawn.filename}"`,
    },
  });
}
