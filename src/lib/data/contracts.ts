// The archive list and detail. Every query intersects `contractScopeWhere`, so a narrowed viewer
// cannot reach a sponsoravtal by paging, searching or guessing an id.
// Counterparty, period and status live on AgreementDetails; the summary types keep a flattened
// shape, null where a PROTOCOL has no `agreement`.
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
import { contractStatus } from "@/lib/contract/status";
import { contractScopeWhere, type ContractScope } from "@/lib/data/contract-scope";
import type { ContractFileRole, ContractKind, ContractStatus } from "@/lib/domain/types";
import { isoDay } from "@/lib/domain/date";

export interface ContractSummary {
  id: string;
  kind: ContractKind;
  /** Null for PROTOCOL and OTHER (no draft/signed workflow). Only set for CONTRACT. */
  status: ContractStatus | null;
  title: string;
  /** Null for PROTOCOL, and for an OTHER naming no counterparty. */
  counterparty: string | null;
  /** ISO days, or null. Only set for CONTRACT; see `date` for the other kinds. */
  validFrom: string | null;
  validTo: string | null;
  /** The one date a lean document carries. Null for CONTRACT. */
  date: string | null;
  tags: string[];
  /** Whether there is anything to open: a filed document may have no file yet. */
  fileCount: number;
  createdAt: string;
}

interface ContractFileRow {
  id: string;
  role: ContractFileRole;
  filename: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  uploadedBy: string | null;
  createdAt: string;
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
  signatureCount: number;
  /** The lines added up, and what came off them (lib/contract/rental/pricing.ts). */
  subtotalOre: number;
  discountOre: number;
  priceOre: number;
  returnedAt: string | null;
  /** When it was inspected and accepted, which the villkor turn on. */
  checkedAt: string | null;
  checkedBy: string | null;
  conditionOut: string | null;
  conditionIn: string | null;
  lines: RentalLineRow[];
}

export interface ContractDetail extends ContractSummary {
  /** The directory row the counterparty was picked from, so a draft edit shows the same pick. */
  counterpartyId: string | null;
  counterpartyOrgNo: string | null;
  /** Where the counterparty is reached on paper. Set by the rental form, null on most of the archive. */
  counterpartyAddress: string | null;
  counterpartyPostalCode: string | null;
  counterpartyCity: string | null;
  counterpartyEmail: string | null;
  counterpartyPhone: string | null;
  notes: string | null;
  termsVersion: string | null;
  createdBy: string | null;
  files: ContractFileRow[];
  rental: RentalDetailRow | null;
}

const CONTRACT_ORDER: Record<
  string,
  ((dir: SortDir) => Prisma.ContractOrderByWithRelationInput) | undefined
> = {
  title: (dir) => ({ title: dir }),
  counterparty: (dir) => ({ agreement: { counterparty: dir } }),
  // Nulls last in both directions: no end date is not a late one.
  validTo: (dir) => ({ agreement: { validTo: { sort: dir, nulls: "last" } } }),
  createdAt: (dir) => ({ createdAt: dir }),
};

const CONTRACT_DEFAULT_ORDER: Prisma.ContractOrderByWithRelationInput[] = [
  { createdAt: "desc" },
  // Tiebreaker so same-millisecond contracts do not swap between pages.
  { id: "desc" },
];

function listQueryWhere(q: ListQuery): Prisma.ContractWhereInput[] {
  const and: Prisma.ContractWhereInput[] = [];

  // A status is whether the signed copy is archived (lib/contract/status.ts), so only CONTRACT rows have one.
  const signed: Prisma.ContractWhereInput = { files: { some: { role: "SIGNED" } } };
  if (q.tab === "draft") and.push({ kind: "CONTRACT", NOT: signed });
  if (q.tab === "signed") and.push({ kind: "CONTRACT", ...signed });

  const kinds = q.picks.filter((p): p is ContractKind =>
    ["CONTRACT", "PROTOCOL", "OTHER"].includes(p),
  );
  if (kinds.length) and.push({ kind: { in: kinds } });

  // The range is asked of `validFrom` or a lean document's `date`, not both ends of a period.
  const date = dateRangeFilter(q, { dateOnly: true });
  if (date) and.push({ OR: [{ agreement: { validFrom: date } }, { date }] });

  if (q.q) {
    and.push({
      OR: [
        { title: { contains: q.q, mode: "insensitive" } },
        { agreement: { counterparty: { contains: q.q, mode: "insensitive" } } },
        { agreement: { counterpartyOrgNo: { contains: q.q, mode: "insensitive" } } },
        // Tags match exactly, with the term normalised the way tags are stored.
        { tags: { has: normaliseTag(q.q) } },
      ],
    });
  }

  return and;
}

export async function getContractPage(
  q: ListQuery,
  scope: ContractScope,
): Promise<RowPage<ContractSummary>> {
  // Scope first, then the reader's filters: a hand-typed query string can widen the second, never the first.
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
          select: { counterparty: true, validFrom: true, validTo: true },
        },
        files: { select: { role: true } },
        _count: { select: { files: true } },
      },
    }),
    prisma.contract.count({ where }),
  ]);

  return {
    rows: rows.map((c) => ({
      id: c.id,
      kind: c.kind,
      status: contractStatus(c),
      title: c.title,
      counterparty: c.agreement?.counterparty ?? null,
      validFrom: isoDayOrNull(c.agreement?.validFrom ?? null),
      validTo: isoDayOrNull(c.agreement?.validTo ?? null),
      date: isoDayOrNull(c.date),
      tags: c.tags,
      fileCount: c._count.files,
      createdAt: c.createdAt.toISOString(),
    })),
    total,
  };
}

export async function getContract(
  id: string,
  scope: ContractScope,
): Promise<ContractDetail | null> {
  // `findFirst` with the scope folded in: out of scope and absent are the same answer, and a caller cannot forget the check.
  const c = await prisma.contract.findFirst({
    where: { AND: [{ id }, contractScopeWhere(scope)] },
    include: {
      agreement: true,
      createdBy: { select: { name: true } },
      files: {
        orderBy: { createdAt: "desc" },
        include: { uploadedBy: { select: { name: true } } },
      },
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
    status: contractStatus(c),
    title: c.title,
    counterparty: c.agreement?.counterparty ?? null,
    counterpartyId: c.agreement?.counterpartyId ?? null,
    counterpartyOrgNo: c.agreement?.counterpartyOrgNo ?? null,
    counterpartyAddress: c.agreement?.counterpartyAddress ?? null,
    counterpartyPostalCode: c.agreement?.counterpartyPostalCode ?? null,
    counterpartyCity: c.agreement?.counterpartyCity ?? null,
    counterpartyEmail: c.agreement?.counterpartyEmail ?? null,
    counterpartyPhone: c.agreement?.counterpartyPhone ?? null,
    validFrom: isoDayOrNull(c.agreement?.validFrom ?? null),
    validTo: isoDayOrNull(c.agreement?.validTo ?? null),
    date: isoDayOrNull(c.date),
    tags: c.tags,
    notes: c.notes,
    termsVersion: c.agreement?.termsVersion ?? null,
    createdBy: c.createdBy.name,
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
    rental: c.rental
      ? {
          pickupAt: c.rental.pickupAt.toISOString(),
          returnAt: c.rental.returnAt.toISOString(),
          purpose: c.rental.purpose,
          signatureCount: c.rental.signatureCount,
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

/** Every tag in use, for the filing form's suggestions. Raw SQL: Prisma cannot `groupBy` an array column. */
export async function getContractTags(scope: ContractScope): Promise<string[]> {
  // Scoped like everything else: tags from the whole archive would leak what a narrowed viewer may not open.
  const rows = await prisma.contract.findMany({
    where: contractScopeWhere(scope),
    select: { tags: true },
  });
  return [...new Set(rows.flatMap((r) => r.tags))].sort();
}

/** A `@db.Date` column as the ISO day it names, with no timezone in the way. */
const isoDayOrNull = (d: Date | null): string | null => (d ? isoDay(d) : null);
