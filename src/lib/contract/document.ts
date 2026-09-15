// The uthyrningsavtal: turning a contract row into the document both parties
// sign, and putting it in the archive.
//
// Shaped after lib/expense/document.ts, down to the render/store split and the
// failure union, because it does the same job for a different document. What is
// stored is a GENERATED file, which is a rendering rather than evidence: draw it
// again from the same row and the same bytes come back, so re-drawing replaces
// rather than accumulates. What a counterparty actually signs comes back as a
// SIGNED file, which nothing here can touch. See lib/contract/files.ts.
//
// The engine is behind rental/typst.ts and reached only through
// `renderRentalContract`, so nothing in this file knows what typesets anything.
import "server-only";

import { prisma } from "@/lib/server/db";
import { replaceGeneratedFile } from "@/lib/contract/files";
import { SECTION } from "./section";
import { RENTAL_TERMS, TERMS_VERSION } from "./rental/terms";
import { linePricing, rentalPricing } from "./rental/pricing";
import { renderRentalContract, RentalRenderError } from "./rental/typst";
import type { RentalContractData } from "./rental/types";

/**
 * Why a contract has no document. Each maps to a message key under
 * `errors.contract`, so a route hands it straight to `fail()`, the same
 * contract lib/expense/document.ts has with its own routes.
 */
export type DocumentFailure =
  | { reason: "notFound" }
  | { reason: "rentalNotFound" }
  | { reason: "renderFailed"; detail: string }
  | { reason: "storeFailed" };

export type RenderResult =
  | { ok: true; bytes: Uint8Array; filename: string }
  | ({ ok: false } & DocumentFailure);

export type StoreResult =
  | { ok: true; fileId: string; filename: string }
  | ({ ok: false } & DocumentFailure);

const nf = new Intl.NumberFormat("sv-SE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** öre → "1 069,00 kr", the way the rest of the app writes money in Swedish. */
const kr = (ore: number): string => `${nf.format(ore / 100)} kr`;

/** An ISO day, which is what a Swedish contract states a date as. */
const day = (d: Date): string => d.toISOString().slice(0, 10);

/** The same, for the live preview, where the period may not be chosen yet. */
const dayOrNull = (d: Date | null): string | null => (d ? day(d) : null);

/**
 * Everything the document needs, and nothing else.
 *
 * Written out rather than derived from the Prisma client's types, so that
 * `buildRentalData` can be called, and tested, with a plain object. Tying it to
 * a generated payload type would mean constructing one in order to assert on
 * the wording, which is the opposite of the point.
 */
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
    /** Null only from the live preview; see RentalContractData. */
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

/**
 * A contract row as the page states it. Pure, and the interesting half.
 *
 * Two decisions live here and are worth naming. The rent is the lines less the
 * discount, from the same function the form and the routes use, so the document
 * cannot state a figure that disagrees with the row. The replacement total is a
 * plain sum, because it says what is at stake and nobody negotiates it.
 */
export function buildRentalData(
  contract: ContractForDocument,
  /** Who is letting the gear out. `SECTION` in every real call; a parameter so
   *  the wording can be asserted on without importing the app's own identity. */
  lessorInfo: RentalContractData["lessor"],
): RentalContractData {
  const { rental } = contract;

  const totalReplacement = rental.lines.reduce(
    (sum, l) => sum + l.replacementValueOre * l.quantity,
    0,
  );
  const pricing = rentalPricing(rental.lines);

  // "223 62 Lund", the way the second line of a Swedish address is set. Either
  // half alone is still worth printing: a contract naming the town but not the
  // postal code is more use than one naming neither.
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
    drawn: day(contract.createdAt),
    pickupAt: dayOrNull(rental.pickupAt),
    returnAt: dayOrNull(rental.returnAt),
    purpose: rental.purpose,
    lines: rental.lines.map((l) => {
      const priced = linePricing(l);
      return {
        description: l.description,
        // With its unit, because a bare number in a column beside three money
        // columns reads as a fourth price.
        quantity: `${l.quantity} st`,
        unitPrice: kr(l.unitPriceOre),
        // Null where nothing came off, so the column can say nothing rather
        // than "0 %" on every row of the ordinary rental.
        discount: priced.discountPercent > 0 ? `${priced.discountPercent} %` : null,
        lineTotal: kr(priced.netOre),
        replacementValue: kr(l.replacementValueOre),
      };
    }),
    subtotal: kr(pricing.subtotalOre),
    // Left out of the document entirely when nothing came off. See the field.
    discount: pricing.discountOre > 0 ? kr(pricing.discountOre) : null,
    // Whether the table needs a discount column at all.
    anyDiscount: pricing.anyDiscount,
    price: kr(pricing.totalOre),
    totalReplacement: kr(totalReplacement),
    signatureCount: rental.signatureCount,
    terms: RENTAL_TERMS,
    termsVersion: TERMS_VERSION,
  };
}

/** What the file is called in the archive and on the reader's disk. */
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

/**
 * Draw the document from a form that has not been saved, and may never be.
 *
 * The rental form shows this in the panel beside it, redrawn as the answers
 * change, so somebody filling one in is looking at the contract rather than at
 * a description of one. There is no row to read: the draft *is* the input.
 *
 * It goes through `buildRentalData` like everything else, which is the point.
 * A preview built by its own path would be a second opinion about what the
 * document says, and the one thing a preview must never be is wrong about the
 * thing it is previewing. What differs is only that every field may be missing,
 * which the data shape already allows for.
 */
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
    // The day it would be drawn, which for an unsaved draft is today.
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
    return { ok: true, bytes: await renderRentalContract(data), filename: filenameFor(contract) };
  } catch (e) {
    return {
      ok: false,
      reason: "renderFailed",
      detail: e instanceof RentalRenderError ? e.message : String(e),
    };
  }
}

/** What a preview is drawn from: the form, with everything allowed to be
 *  missing because it is being filled in. */
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

/** Draw the document without keeping it. What a stored contract's preview asks
 *  for. */
export async function renderContractDocument(contractId: string): Promise<RenderResult> {
  const row = await prisma.contract.findUnique({
    where: { id: contractId },
    ...forDocument,
  });
  if (!row) return { ok: false, reason: "notFound" };
  if (!row.rental) return { ok: false, reason: "rentalNotFound" };
  // A rental is a CONTRACT row, so it always has an `agreement` with a
  // counterparty; CreateRental requires it. `counterparty` is nullable on
  // the model only for the OTHER-with-counterparty case, which a rental can
  // never be, so this doubles as the check that narrows it below.
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

/**
 * Draw it and put it in the archive, replacing the previous rendering.
 *
 * What a contract's own screen asks for. The stored file is the one that will
 * be sent for signature, so there is exactly one of them: two renderings in the
 * archive would be two documents with nothing saying which was the one signed.
 */
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
    // The version the bytes were drawn under, so a list can say which contracts
    // predate a change to the terms without opening each one. On AgreementDetails
    // now, not Contract; a rental always has one.
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
