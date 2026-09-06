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
import { RENTAL_TERMS, TERMS_VERSION } from "./rental/terms";
import { renderRentalContract, RentalRenderError } from "./rental/typst";
import type { RentalContractData, RentalParty } from "./rental/types";

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

/**
 * The lessor, as the document names it.
 *
 * Read from the Fortnox connection, which is the one place in this app that
 * already holds the section's registered name and organisation number, kept in
 * step by the sync rather than typed into a settings screen somebody would have
 * to remember to update.
 *
 * The fallback is not a guess at the section's legal name so much as a refusal
 * to leave the field blank on a document two people are about to sign: a
 * contract naming no lessor is worse than one naming the section the way
 * everybody says it out loud. Connect Fortnox and it says the registered name
 * instead.
 */
const FALLBACK_LESSOR = "D-sektionen inom TLTH";

async function lessor(): Promise<{ name: string; orgNo: string | null }> {
  const conn = await prisma.fortnoxConnection.findFirst({
    select: { companyName: true, orgNumber: true },
    orderBy: { createdAt: "desc" },
  });
  return {
    name: conn?.companyName?.trim() || FALLBACK_LESSOR,
    orgNo: conn?.orgNumber?.trim() || null,
  };
}

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
  createdAt: Date;
  rental: {
    pickupAt: Date;
    returnAt: Date;
    purpose: string | null;
    place: string | null;
    priceOre: number;
    depositOre: number;
    lines: {
      description: string;
      quantity: number;
      unitPriceOre: number;
      replacementValueOre: number;
    }[];
  };
  parties: {
    role: "SECTION" | "COUNTERPARTY";
    name: string;
    title: string | null;
    orgName: string | null;
    orgNo: string | null;
    email: string | null;
    phone: string | null;
  }[];
};

const asParty = (p: ContractForDocument["parties"][number] | undefined): RentalParty | null =>
  p
    ? {
        name: p.name,
        title: p.title,
        orgName: p.orgName,
        orgNo: p.orgNo,
        email: p.email,
        phone: p.phone,
      }
    : null;

/**
 * A contract row as the page states it. Pure, and the interesting half.
 *
 * Two decisions live here and are worth naming. The rent printed is the one
 * that was *agreed* (`priceOre`), not the lines added up: a rental can be
 * priced as a whole, and lending gear to another section for nothing is a real
 * and common case that a computed total would print as a lie. The replacement
 * total is the opposite, a genuine sum, because it says what is at stake and
 * nobody negotiates it.
 */
export function buildRentalData(
  contract: ContractForDocument,
  lessorInfo: { name: string; orgNo: string | null },
): RentalContractData {
  const { rental } = contract;

  const totalReplacement = rental.lines.reduce(
    (sum, l) => sum + l.replacementValueOre * l.quantity,
    0,
  );

  return {
    lessor: lessorInfo,
    counterparty: contract.counterparty,
    counterpartyOrgNo: contract.counterpartyOrgNo,
    title: contract.title,
    drawn: day(contract.createdAt),
    pickupAt: day(rental.pickupAt),
    returnAt: day(rental.returnAt),
    purpose: rental.purpose,
    place: rental.place,
    lines: rental.lines.map((l) => ({
      description: l.description,
      // With its unit, because a bare number in a column beside three money
      // columns reads as a fourth price.
      quantity: `${l.quantity} st`,
      unitPrice: kr(l.unitPriceOre),
      lineTotal: kr(l.unitPriceOre * l.quantity),
      replacementValue: kr(l.replacementValueOre),
    })),
    price: kr(rental.priceOre),
    deposit: kr(rental.depositOre),
    totalReplacement: kr(totalReplacement),
    sectionParty: asParty(contract.parties.find((p) => p.role === "SECTION")),
    counterpartyParty: asParty(contract.parties.find((p) => p.role === "COUNTERPARTY")),
    terms: RENTAL_TERMS,
    termsVersion: TERMS_VERSION,
  };
}

/** What the file is called in the archive and on the reader's disk. */
const filenameFor = (contract: { counterparty: string; rental: { pickupAt: Date } }): string => {
  const who = contract.counterparty
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `uthyrningsavtal-${day(contract.rental.pickupAt)}${who ? `-${who}` : ""}.pdf`;
};

const forDocument = {
  select: {
    id: true,
    title: true,
    counterparty: true,
    counterpartyOrgNo: true,
    createdAt: true,
    rental: {
      select: {
        pickupAt: true,
        returnAt: true,
        purpose: true,
        place: true,
        priceOre: true,
        depositOre: true,
        lines: {
          orderBy: { sortOrder: "asc" as const },
          select: {
            description: true,
            quantity: true,
            unitPriceOre: true,
            replacementValueOre: true,
          },
        },
      },
    },
    parties: {
      select: {
        role: true,
        name: true,
        title: true,
        orgName: true,
        orgNo: true,
        email: true,
        phone: true,
      },
    },
  },
} as const;

/** Draw the document without keeping it. What a preview asks for. */
export async function renderContractDocument(contractId: string): Promise<RenderResult> {
  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    ...forDocument,
  });
  if (!contract) return { ok: false, reason: "notFound" };
  if (!contract.rental) return { ok: false, reason: "rentalNotFound" };

  const data = buildRentalData(contract as ContractForDocument, await lessor());
  try {
    const bytes = await renderRentalContract(data);
    return { ok: true, bytes, filename: filenameFor(contract as ContractForDocument) };
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
    // predate a change to the terms without opening each one.
    await prisma.contract.update({
      where: { id: contractId },
      data: { termsVersion: TERMS_VERSION },
    });
    return { ok: true, fileId: stored.id, filename: stored.filename };
  } catch (e) {
    console.error(`[contracts] ${contractId}: could not store the drawn document`, e);
    return { ok: false, reason: "storeFailed" };
  }
}
