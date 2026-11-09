// The uthyrningsavtal: turns a contract row into the document both parties sign and files
// it in the archive (shaped after lib/expense/document.ts). A GENERATED file is a
// rendering, so re-drawing replaces it; a SIGNED file is never touched (lib/contract/files.ts).
import "server-only";

import { prisma } from "@/lib/server/db";
import { replaceGeneratedFile } from "@/lib/contract/files";
import { SECTION } from "./section";
import { RENTAL_TERMS, TERMS_VERSION } from "./rental/terms";
import { linePricing, rentalPricing } from "./rental/pricing";
import { renderRentalContract, RentalRenderError } from "./rental/typst";
import type { RentalContractData } from "./rental/types";
import { isoDay } from "@/lib/domain/date";
import { formatOreKr } from "@/lib/ui/format";

/** Why a contract has no document. Each maps to a message key under `errors.contract`. */
export type DocumentFailure =
  | { reason: "notFound" }
  | { reason: "rentalNotFound" }
  | { reason: "renderFailed"; detail: string }
  | { reason: "storeFailed" };

export type RenderResult =
  { ok: true; bytes: Uint8Array; filename: string } | ({ ok: false } & DocumentFailure);

export type StoreResult =
  { ok: true; fileId: string; filename: string } | ({ ok: false } & DocumentFailure);

/** An ISO day. Null in the live preview, where the period may not be chosen yet. */
const dayOrNull = (d: Date | null): string | null => (d ? isoDay(d) : null);

/** Everything the document needs, as a plain object so `buildRentalData` is testable without Prisma. */
export type ContractForDocument = {
  title: string;
  counterparty: string;
  counterpartyOrgNo: string | null;
  counterpartyAddress: string | null;
  counterpartyPostalCode: string | null;
  counterpartyCity: string | null;
  counterpartyEmail: string | null;
  counterpartyPhone: string | null;
  createdAt: Date;
  rental: {
    pickupAt: Date | null;
    returnAt: Date | null;
    purpose: string | null;
    signatureCount: number;
    lines: {
      description: string;
      quantity: number;
      unitPriceOre: number;
      discountPercent: number;
      replacementValueOre: number;
    }[];
  };
};

/** A contract row as the page states it. Pure. The rent comes from the shared pricing function so the document cannot disagree with the row. */
export function buildRentalData(
  contract: ContractForDocument,
  /** Who is letting the gear out. */
  lessorInfo: RentalContractData["lessor"],
): RentalContractData {
  const { rental } = contract;

  const totalReplacement = rental.lines.reduce(
    (sum, l) => sum + l.replacementValueOre * l.quantity,
    0,
  );
  const pricing = rentalPricing(rental.lines);

  // "223 62 Lund". Either half alone is still printed.
  const postalLine =
    [contract.counterpartyPostalCode, contract.counterpartyCity]
      .map((v) => v?.trim())
      .filter((v): v is string => Boolean(v))
      .join(" ") || null;

  return {
    lessor: lessorInfo,
    counterparty: contract.counterparty,
    counterpartyOrgNo: contract.counterpartyOrgNo,
    counterpartyAddress: contract.counterpartyAddress,
    counterpartyPostalLine: postalLine,
    counterpartyEmail: contract.counterpartyEmail,
    counterpartyPhone: contract.counterpartyPhone,
    title: contract.title,
    drawn: isoDay(contract.createdAt),
    pickupAt: dayOrNull(rental.pickupAt),
    returnAt: dayOrNull(rental.returnAt),
    purpose: rental.purpose,
    lines: rental.lines.map((l) => {
      const priced = linePricing(l);
      return {
        description: l.description,
        // With its unit, so it does not read as a fourth price.
        quantity: `${l.quantity} st`,
        unitPrice: formatOreKr(l.unitPriceOre, { decimals: 2 }),
        // Null where nothing came off, so the column stays empty.
        discount: priced.discountPercent > 0 ? `${priced.discountPercent} %` : null,
        lineTotal: formatOreKr(priced.netOre, { decimals: 2 }),
        replacementValue: formatOreKr(l.replacementValueOre, { decimals: 2 }),
      };
    }),
    subtotal: formatOreKr(pricing.subtotalOre, { decimals: 2 }),
    discount: pricing.discountOre > 0 ? formatOreKr(pricing.discountOre, { decimals: 2 }) : null,
    anyDiscount: pricing.anyDiscount,
    price: formatOreKr(pricing.totalOre, { decimals: 2 }),
    totalReplacement: formatOreKr(totalReplacement, { decimals: 2 }),
    signatureCount: rental.signatureCount,
    terms: RENTAL_TERMS,
    termsVersion: TERMS_VERSION,
  };
}

const filenameFor = (contract: {
  counterparty: string;
  rental: { pickupAt: Date | null };
}): string => {
  const who = contract.counterparty
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  const when = dayOrNull(contract.rental.pickupAt);
  return `uthyrningsavtal${when ? `-${when}` : ""}${who ? `-${who}` : ""}.pdf`;
};

const forDocument = {
  select: {
    id: true,
    title: true,
    createdAt: true,
    agreement: {
      select: {
        counterparty: true,
        counterpartyOrgNo: true,
        counterpartyAddress: true,
        counterpartyPostalCode: true,
        counterpartyCity: true,
        counterpartyEmail: true,
        counterpartyPhone: true,
      },
    },
    rental: {
      select: {
        pickupAt: true,
        returnAt: true,
        purpose: true,
        signatureCount: true,
        lines: {
          orderBy: { sortOrder: "asc" as const },
          select: {
            description: true,
            quantity: true,
            unitPriceOre: true,
            discountPercent: true,
            replacementValueOre: true,
          },
        },
      },
    },
  },
} as const;

/** Draw the document from an unsaved form, through `buildRentalData` so a preview cannot disagree with the real thing. Any field may be missing. */
export async function renderRentalPreview(draft: RentalDraft): Promise<RenderResult> {
  const contract: ContractForDocument = {
    title: draft.title,
    counterparty: draft.counterparty,
    counterpartyOrgNo: draft.counterpartyOrgNo,
    counterpartyAddress: draft.counterpartyAddress,
    counterpartyPostalCode: draft.counterpartyPostalCode,
    counterpartyCity: draft.counterpartyCity,
    counterpartyEmail: draft.counterpartyEmail,
    counterpartyPhone: draft.counterpartyPhone,
    createdAt: new Date(),
    rental: {
      pickupAt: draft.pickupAt,
      returnAt: draft.returnAt,
      purpose: draft.purpose,
      signatureCount: draft.signatureCount,
      lines: draft.lines,
    },
  };

  const data = buildRentalData(contract, SECTION);
  try {
    return {
      ok: true,
      bytes: await renderRentalContract(data),
      filename: filenameFor(contract),
    };
  } catch (e) {
    return {
      ok: false,
      reason: "renderFailed",
      detail: e instanceof RentalRenderError ? e.message : String(e),
    };
  }
}

/** What a preview is drawn from: the form, any field may be missing. */
export type RentalDraft = {
  title: string;
  counterparty: string;
  counterpartyOrgNo: string | null;
  counterpartyAddress: string | null;
  counterpartyPostalCode: string | null;
  counterpartyCity: string | null;
  counterpartyEmail: string | null;
  counterpartyPhone: string | null;
  pickupAt: Date | null;
  returnAt: Date | null;
  purpose: string | null;
  signatureCount: number;
  lines: ContractForDocument["rental"]["lines"];
};

/** Draw the document without keeping it. */
export async function renderContractDocument(contractId: string): Promise<RenderResult> {
  const row = await prisma.contract.findUnique({
    where: { id: contractId },
    ...forDocument,
  });
  if (!row) return { ok: false, reason: "notFound" };
  if (!row.rental) return { ok: false, reason: "rentalNotFound" };
  // A rental is a CONTRACT row, so it always has an `agreement` with a counterparty.
  if (!row.agreement || row.agreement.counterparty === null) {
    return { ok: false, reason: "rentalNotFound" };
  }

  const contract: ContractForDocument = {
    title: row.title,
    counterparty: row.agreement.counterparty,
    counterpartyOrgNo: row.agreement.counterpartyOrgNo,
    counterpartyAddress: row.agreement.counterpartyAddress,
    counterpartyPostalCode: row.agreement.counterpartyPostalCode,
    counterpartyCity: row.agreement.counterpartyCity,
    counterpartyEmail: row.agreement.counterpartyEmail,
    counterpartyPhone: row.agreement.counterpartyPhone,
    createdAt: row.createdAt,
    rental: row.rental,
  };

  const data = buildRentalData(contract, SECTION);
  try {
    const bytes = await renderRentalContract(data);
    return { ok: true, bytes, filename: filenameFor(contract) };
  } catch (e) {
    return {
      ok: false,
      reason: "renderFailed",
      detail: e instanceof RentalRenderError ? e.message : String(e),
    };
  }
}

/** Draw it and file it, replacing the previous rendering so exactly one exists to be sent for signature. */
export async function storeContractDocument(
  contractId: string,
  actorId: string | null,
): Promise<StoreResult> {
  const drawn = await renderContractDocument(contractId);
  if (!drawn.ok) return drawn;

  try {
    const stored = await replaceGeneratedFile({
      contractId,
      filename: drawn.filename,
      mimeType: "application/pdf",
      bytes: Buffer.from(drawn.bytes),
      uploadedById: actorId,
    });
    // The version the bytes were drawn under, so a list can show which contracts predate a terms change.
    await prisma.contract.update({
      where: { id: contractId },
      data: { agreement: { update: { termsVersion: TERMS_VERSION } } },
    });
    return { ok: true, fileId: stored.id, filename: stored.filename };
  } catch (e) {
    console.error(`[contracts] ${contractId}: could not store the drawn document`, e);
    return { ok: false, reason: "storeFailed" };
  }
}
