// Reading the document archive: one page of the list, and one document in
// full.
//
// Shaped after lib/data/expenses.ts, and for the same reason: the filtering,
// the sorting and the cut happen in Postgres rather than in the browser, so the
// page a Server Component renders is the page it asked for.
//
// Who may read what IS decided here, through a scope, and that changed once the
// uthyrningsansvarig existed. CONTRACT_VIEW is the whole archive; RENTAL_VIEW is
// the uthyrningsavtal in it and nothing else. Every query below intersects with
// `contractScopeWhere`, so a narrowed viewer cannot reach a sponsoravtal by
// paging, searching or guessing an id.
//
// The counterparty, the period and the status all live on AgreementDetails
// now, not on Contract itself — see the schema file. `ContractSummary` and
// `ContractDetail` keep the flattened shape they always had (`counterparty:
// string | null`, and so on), computed here from the joined relation, so
// every reader of these types stays exactly as it was: a PROTOCOL row simply
// has no `agreement` to join, and its fields read null the same way they
// already had to once PROTOCOL existed at all.
import "server-only";

import { prisma } from "@/lib/server/db";
import { Prisma } from "@/lib/generated/prisma/client";
import {
  dateRangeFilter,
  pageBounds,
  type ListQuery,
  type RowPage,
  type SortDir,
} from "@/lib/data/list-query";
import { normaliseTag } from "@/lib/contract/tags";
import { CONTRACT_STATUS_TAB } from "@/lib/contract/status";
import { contractScopeWhere, type ContractScope } from "@/lib/data/contract-scope";
import type {
  ContractFileRole,
  ContractKind,
  ContractPartyRole,
  ContractSignatureMethod,
  ContractStatus,
} from "@/lib/domain/types";

/** A row in the archive table. */
export interface ContractSummary {
  id: string;
  kind: ContractKind;
  /** Null for PROTOCOL and OTHER: a lean document is filed or it doesn't
   *  exist, with no draft/signed workflow to track, even for an OTHER that
   *  names a counterparty. Only ever set for CONTRACT. */
  status: ContractStatus | null;
  title: string;
  /** Null for PROTOCOL, and for an OTHER that names no counterparty; neither
   *  is an agreement with anybody. */
  counterparty: string | null;
  /** ISO days, or null where the agreement states none. Only ever set for
   *  CONTRACT, which states a period; see `date` for the other two kinds. */
  validFrom: string | null;
  validTo: string | null;
  /** The one date a lean document carries. Null for CONTRACT, which states
   *  a period instead. */
  date: string | null;
  tags: string[];
  /** Whether there is anything to open. A filed document with no file yet
   *  is a real state, and the list says so rather than offering a dead link. */
  fileCount: number;
  createdAt: string;
}

export interface ContractFileRow {
  id: string;
  role: ContractFileRole;
  filename: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  uploadedBy: string | null;
  createdAt: string;
}

export interface ContractPartyRow {
  id: string;
  role: ContractPartyRole;
  name: string;
  email: string | null;
  phone: string | null;
  orgName: string | null;
  orgNo: string | null;
  title: string | null;
  signedAt: string | null;
  signatureMethod: ContractSignatureMethod | null;
}

export interface RentalLineRow {
  id: string;
  itemId: string | null;
  description: string;
  quantity: number;
  unitPriceOre: number;
  /** What came off this line, 0 to 100. See lib/contract/rental/pricing.ts. */
  discountPercent: number;
  replacementValueOre: number;
}

export interface RentalDetailRow {
  pickupAt: string;
  returnAt: string;
  purpose: string | null;
  place: string | null;
  /** When the rent falls due. Null means at pickup. */
  paymentDueAt: string | null;
  /** The lines added up, and what came off them. The rent is the difference;
   *  see lib/contract/rental/pricing.ts. */
  subtotalOre: number;
  discountOre: number;
  priceOre: number;
  /** When it physically came back. */
  returnedAt: string | null;
  /** When it was inspected and accepted, which is the event the villkor turn
   *  on. See the RentalDetails model. */
  checkedAt: string | null;
  checkedBy: string | null;
  conditionOut: string | null;
  conditionIn: string | null;
  lines: RentalLineRow[];
}

export interface ContractDetail extends ContractSummary {
  counterpartyOrgNo: string | null;
  /** Where the counterparty is reached on paper. Set by the rental form, which
   *  insists on it, and null on most of the archive. */
  counterpartyAddress: string | null;
  counterpartyPostalCode: string | null;
  counterpartyCity: string | null;
  notes: string | null;
  termsVersion: string | null;
  createdBy: string | null;
  files: ContractFileRow[];
  parties: ContractPartyRow[];
  rental: RentalDetailRow | null;
}

// ── Filtering ─────────────────────────────────────────────────────

const CONTRACT_ORDER: Record<
  string,
  ((dir: SortDir) => Prisma.ContractOrderByWithRelationInput) | undefined
> = {
  title: (dir) => ({ title: dir }),
  counterparty: (dir) => ({ agreement: { counterparty: dir } }),
  // Nulls last in both directions: a contract with no end date has not got a
  // late one, and Postgres would otherwise sort it as though it had.
  validTo: (dir) => ({ agreement: { validTo: { sort: dir, nulls: "last" } } }),
  createdAt: (dir) => ({ createdAt: dir }),
};

/** Newest first, which is what somebody who just filed one wants to see. */
const CONTRACT_DEFAULT_ORDER: Prisma.ContractOrderByWithRelationInput[] = [
  { createdAt: "desc" },
  // A tiebreaker, so two contracts filed in the same millisecond do not swap
  // places between pages. Same reason the expense list has one.
  { id: "desc" },
];

function listQueryWhere(q: ListQuery): Prisma.ContractWhereInput[] {
  const and: Prisma.ContractWhereInput[] = [];

  // Only ever matches CONTRACT rows: PROTOCOL/OTHER have no `agreement` to
  // hold a status, so a status tab naturally shows only agreements, and a
  // lean document only ever appears under "Alla".
  const statuses = CONTRACT_STATUS_TAB[q.tab];
  if (statuses?.length) and.push({ agreement: { status: { in: statuses } } });

  // The dropdown picks kinds, OR-ed. Picking none narrows nothing.
  const kinds = q.picks.filter((p): p is ContractKind =>
    ["CONTRACT", "PROTOCOL", "OTHER"].includes(p),
  );
  if (kinds.length) and.push({ kind: { in: kinds } });

  // The range is asked of whichever date a row actually has: an agreement's
  // `validFrom` ("which agreements started in this period"), or a lean
  // document's own `date`. Asking it of a period's both ends would mean a
  // contract only matched when it began *and* ended inside the window,
  // which is not what anyone means by it.
  const date = dateRangeFilter(q, { dateOnly: true });
  if (date) and.push({ OR: [{ agreement: { validFrom: date } }, { date }] });

  if (q.q) {
    and.push({
      OR: [
        { title: { contains: q.q, mode: "insensitive" } },
        { agreement: { counterparty: { contains: q.q, mode: "insensitive" } } },
        { agreement: { counterpartyOrgNo: { contains: q.q, mode: "insensitive" } } },
        // Tags match exactly, where the two above match on substring. A tag is
        // one chosen word rather than prose, so "ljud" finding the "ljud" tag
        // is the whole of what anybody expects, and the same normalisation the
        // tag was stored under is applied to the search term so that typing it
        // in capitals still finds it.
        { tags: { has: normaliseTag(q.q) } },
      ],
    });
  }

  return and;
}

/** One page of the archive, and how many rows are behind it. */
export async function getContractPage(
  q: ListQuery,
  scope: ContractScope,
): Promise<RowPage<ContractSummary>> {
  // The scope first, then what the reader asked for. Two filters, always both:
  // a hand-typed query string can widen the second and never the first.
  const where: Prisma.ContractWhereInput = {
    AND: [contractScopeWhere(scope), ...listQueryWhere(q)],
  };
  const { skip, take } = pageBounds(q);
  const order = CONTRACT_ORDER[q.sort];

  const [rows, total] = await Promise.all([
    prisma.contract.findMany({
      where,
      orderBy: order ? [order(q.dir), { id: "desc" }] : CONTRACT_DEFAULT_ORDER,
      skip,
      take,
      select: {
        id: true,
        kind: true,
        title: true,
        date: true,
        tags: true,
        createdAt: true,
        agreement: {
          select: { counterparty: true, validFrom: true, validTo: true, status: true },
        },
        _count: { select: { files: true } },
      },
    }),
    prisma.contract.count({ where }),
  ]);

  return {
    rows: rows.map((c) => ({
      id: c.id,
      kind: c.kind,
      status: c.agreement?.status ?? null,
      title: c.title,
      counterparty: c.agreement?.counterparty ?? null,
      validFrom: isoDay(c.agreement?.validFrom ?? null),
      validTo: isoDay(c.agreement?.validTo ?? null),
      date: isoDay(c.date),
      tags: c.tags,
      fileCount: c._count.files,
      createdAt: c.createdAt.toISOString(),
    })),
    total,
  };
}

/** One contract, with everything the detail page draws. */
export async function getContract(
  id: string,
  scope: ContractScope,
): Promise<ContractDetail | null> {
  // `findFirst` with the scope folded in, rather than `findUnique` and a check
  // afterwards. Out of scope and not there are the same answer to whoever is
  // asking, and writing it this way means a caller cannot forget the check.
  const c = await prisma.contract.findFirst({
    where: { AND: [{ id }, contractScopeWhere(scope)] },
    include: {
      agreement: true,
      createdBy: { select: { name: true } },
      files: {
        orderBy: { createdAt: "desc" },
        include: { uploadedBy: { select: { name: true } } },
      },
      parties: { orderBy: [{ role: "asc" }, { createdAt: "asc" }] },
      rental: {
        include: {
          lines: { orderBy: { sortOrder: "asc" } },
          checkedBy: { select: { name: true } },
        },
      },
    },
  });
  if (!c) return null;

  return {
    id: c.id,
    kind: c.kind,
    status: c.agreement?.status ?? null,
    title: c.title,
    counterparty: c.agreement?.counterparty ?? null,
    counterpartyOrgNo: c.agreement?.counterpartyOrgNo ?? null,
    counterpartyAddress: c.agreement?.counterpartyAddress ?? null,
    counterpartyPostalCode: c.agreement?.counterpartyPostalCode ?? null,
    counterpartyCity: c.agreement?.counterpartyCity ?? null,
    validFrom: isoDay(c.agreement?.validFrom ?? null),
    validTo: isoDay(c.agreement?.validTo ?? null),
    date: isoDay(c.date),
    tags: c.tags,
    notes: c.notes,
    termsVersion: c.agreement?.termsVersion ?? null,
    createdBy: c.createdBy?.name ?? null,
    fileCount: c.files.length,
    createdAt: c.createdAt.toISOString(),
    files: c.files.map((f) => ({
      id: f.id,
      role: f.role,
      filename: f.filename,
      mimeType: f.mimeType,
      byteSize: f.byteSize,
      sha256: f.sha256,
      uploadedBy: f.uploadedBy?.name ?? null,
      createdAt: f.createdAt.toISOString(),
    })),
    parties: c.parties.map((p) => ({
      id: p.id,
      role: p.role,
      name: p.name,
      email: p.email,
      phone: p.phone,
      orgName: p.orgName,
      orgNo: p.orgNo,
      title: p.title,
      signedAt: p.signedAt?.toISOString() ?? null,
      signatureMethod: p.signatureMethod,
    })),
    rental: c.rental
      ? {
          pickupAt: c.rental.pickupAt.toISOString(),
          returnAt: c.rental.returnAt.toISOString(),
          purpose: c.rental.purpose,
          place: c.rental.place,
          paymentDueAt: c.rental.paymentDueAt?.toISOString() ?? null,
          subtotalOre: c.rental.subtotalOre,
          discountOre: c.rental.discountOre,
          priceOre: c.rental.priceOre,
          returnedAt: c.rental.returnedAt?.toISOString() ?? null,
          checkedAt: c.rental.checkedAt?.toISOString() ?? null,
          checkedBy: c.rental.checkedBy?.name ?? null,
          conditionOut: c.rental.conditionOut,
          conditionIn: c.rental.conditionIn,
          lines: c.rental.lines.map((l) => ({
            id: l.id,
            itemId: l.itemId,
            description: l.description,
            quantity: l.quantity,
            unitPriceOre: l.unitPriceOre,
            discountPercent: l.discountPercent,
            replacementValueOre: l.replacementValueOre,
          })),
        }
      : null,
  };
}

/**
 * Every tag in use, for the filing form's suggestions.
 *
 * A `groupBy` over an array column is not something Prisma expresses, and
 * unnesting in SQL is the one statement that answers it. The list is short (a
 * section's vocabulary, not a corpus) and the archive is small, so this reads
 * the column rather than maintaining a table nothing else would want.
 */
export async function getContractTags(scope: ContractScope): Promise<string[]> {
  // Scoped like everything else. A tag vocabulary drawn from the whole archive
  // would leak what the section files under, which is exactly the sort of thing
  // a narrowed viewer is not meant to learn: "axis-sponsring" is a fact about a
  // contract they may not open.
  const rows = await prisma.contract.findMany({
    where: contractScopeWhere(scope),
    select: { tags: true },
  });
  return [...new Set(rows.flatMap((r) => r.tags))].sort();
}

/** A `@db.Date` column as the ISO day it names, with no timezone in the way. */
const isoDay = (d: Date | null): string | null => d?.toISOString().slice(0, 10) ?? null;
