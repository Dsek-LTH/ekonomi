// Who may see what: triage and bookkeeping roles see every invoice (inkorg included); a
// resultatansvarig sees those given to their units and any konterad onto their cost centres; nobody
// else. One rule answers both list and single invoice (the latter is the former narrowed to one id).
import "server-only";

import { prisma } from "@/lib/server/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import {
  costCentreWhereForPrefixes,
  getPrefixes,
  ownedResultUnits,
  resultUnitNameForCode,
  type PrefixRow,
} from "@/lib/server/result-units";
import {
  canViewBookkeeping,
  canAttestAllocation,
  canTriageInvoices,
  isAdmin,
} from "@/lib/domain/permissions";
import {
  invoiceCapabilities,
  invoiceQueue,
  invoiceWaitsOn,
  type InvoiceQueue,
  type InvoiceCapabilities,
  type InvoiceViewer,
} from "@/lib/domain/supplier-invoice";
import { oreToSEK as ore } from "@/lib/domain/money";
import type {
  SupplierInvoiceEventType,
  SupplierInvoiceSource,
  SupplierInvoiceStatus,
} from "@/lib/domain/types";
import type { AutoRule } from "@/lib/domain/inbound-mail";
import { gmailConfig } from "@/lib/server/gmail";
import type { DocumentReading } from "@/lib/server/invoice-documents";
import type { Viewer } from "./expense-scope";
import { isoDate } from "./shared";

/** Everything the rules need about a viewer, plus unit names (what canAttestAllocation compares). */
export interface InvoiceViewerCtx extends InvoiceViewer {
  ownedResultUnitNames: string[];
  ownedPrefixes: string[];
  prefixes: PrefixRow[];
}

export async function invoiceViewerOf(viewer: Viewer): Promise<InvoiceViewerCtx> {
  const [{ names, prefixes: owned }, prefixes] = await Promise.all([
    ownedResultUnits(viewer),
    getPrefixes(),
  ]);
  // The ids behind the names, from the prefix table in hand. A unit with no prefixes is looked up.
  const ids = new Map(prefixes.map((p) => [p.resultUnitName, p.resultUnitId]));
  const missing = names.filter((n) => !ids.has(n));
  if (missing.length) {
    const rows = await prisma.resultUnit.findMany({
      where: { name: { in: missing } },
      select: { id: true, name: true },
    });
    for (const r of rows) ids.set(r.name, r.id);
  }
  return {
    id: viewer.id,
    roles: viewer.roles,
    capabilities: viewer.capabilities,
    ownedResultUnitIds: names.flatMap((n) => (ids.has(n) ? [ids.get(n)!] : [])),
    ownedResultUnitNames: names,
    ownedPrefixes: owned,
    prefixes,
  };
}

/** Result units the viewer may attest for: every one for an admin, else those they answer for. */
export interface AttestReach {
  all: boolean;
  units: string[];
}

export function attestReachOf(v: InvoiceViewerCtx): AttestReach {
  return { all: isAdmin(v.capabilities), units: v.ownedResultUnitNames };
}

const seesEverything = (v: InvoiceViewer) =>
  canTriageInvoices(v.capabilities) ||
  canViewBookkeeping(v.capabilities) ||
  isAdmin(v.capabilities);

/** The viewer's reach as a filter. No reach matches nothing: an empty `OR` would mean everything. */
export function invoiceScopeWhere(
  v: InvoiceViewerCtx,
  /** Only the reader's own result units', even for one who sees everything (Min resultatenhet). */
  { ownUnits = false }: { ownUnits?: boolean } = {},
): Prisma.SupplierInvoiceWhereInput {
  if (!ownUnits && seesEverything(v)) return {};

  const OR: Prisma.SupplierInvoiceWhereInput[] = [];
  if (v.ownedResultUnitIds.length) OR.push({ resultUnitId: { in: [...v.ownedResultUnitIds] } });
  if (v.ownedPrefixes.length) {
    OR.push({
      allocations: { some: { costCenter: costCentreWhereForPrefixes(v.ownedPrefixes) } },
    });
  }
  if (OR.length === 0) return { id: { in: [] } };
  return { OR };
}

export function mayAttest(v: InvoiceViewerCtx, costCenterCode: string): boolean {
  return canAttestAllocation({
    actorCapabilities: v.capabilities,
    actorRoles: v.roles,
    // Nobody claims money on an invoice, so nobody is excluded as submitter (lib/domain/supplier-invoice.ts).
    actorIsSubmitter: false,
    actorOwnedResultUnits: v.ownedResultUnitNames,
    allocationResultUnit: resultUnitNameForCode(costCenterCode, v.prefixes),
  });
}

export function invoiceFactsOf(
  v: InvoiceViewerCtx,
  inv: {
    status: SupplierInvoiceStatus;
    resultUnitId: string | null;
    allocations: { approvedById: string | null; costCenter: { code: string } }[];
  },
) {
  return {
    status: inv.status,
    resultUnitId: inv.resultUnitId,
    allocations: inv.allocations.map((a) => ({
      approved: a.approvedById !== null,
      approvedById: a.approvedById,
      viewerMayAttest: mayAttest(v, a.costCenter.code),
    })),
  };
}

export interface SupplierInvoiceRow {
  id: string;
  /** "LEV26-0012". */
  reference: string | null;
  status: SupplierInvoiceStatus;
  source: SupplierInvoiceSource;
  supplierName: string | null;
  invoiceNumber: string | null;
  description: string | null;
  amount: number | null; // SEK
  dueDate: string; // YYYY-MM-DD, or "" when not filled in
  invoiceDate: string; // YYYY-MM-DD, or "" when not filled in
  receivedAt: string; // ISO
  receivedByName: string | null;
  resultUnitName: string | null;
  /** Where it stands for this viewer: the inbox section it goes in. */
  queue: InvoiceQueue;
  /** Something the viewer has to do: sort it, attest it, or export it. */
  waitsOnViewer: boolean;
}

const ROW_SELECT = {
  id: true,
  reference: true,
  status: true,
  source: true,
  supplierName: true,
  invoiceNumber: true,
  description: true,
  amount: true,
  dueDate: true,
  invoiceDate: true,
  createdAt: true,
  resultUnitId: true,
  receivedBy: { select: { name: true } },
  resultUnit: { select: { name: true } },
  allocations: { select: { approvedById: true, costCenter: { select: { code: true } } } },
} satisfies Prisma.SupplierInvoiceSelect;

/** Every invoice the viewer may see, newest first. Not paged: a few a week, filtered in the browser (ClientDataTable). */
export async function getInvoiceRows(
  viewer: Viewer,
  opts: { ownUnits?: boolean } = {},
): Promise<SupplierInvoiceRow[]> {
  const v = await invoiceViewerOf(viewer);
  const rows = await prisma.supplierInvoice.findMany({
    where: invoiceScopeWhere(v, opts),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: ROW_SELECT,
  });
  return rows.map((r) => ({
    id: r.id,
    reference: r.reference,
    status: r.status,
    source: r.source,
    supplierName: r.supplierName,
    invoiceNumber: r.invoiceNumber,
    description: r.description,
    amount: r.amount == null ? null : ore(r.amount),
    dueDate: isoDate(r.dueDate),
    invoiceDate: isoDate(r.invoiceDate),
    receivedAt: r.createdAt.toISOString(),
    receivedByName: r.receivedBy?.name ?? null,
    resultUnitName: r.resultUnit?.name ?? null,
    queue: invoiceQueue(v, invoiceFactsOf(v, r)),
    waitsOnViewer: invoiceWaitsOn(v, invoiceFactsOf(v, r)),
  }));
}

export interface SupplierInvoiceAllocationView {
  id: string;
  costCenterCode: string;
  costCenterName: string;
  resultUnit: string | null;
  /** Null until the treasurer sets it at the export. */
  account: string | null;
  accountName: string | null;
  project: string | null;
  /** SEK. Null on an invoice with one row, which is the whole of it. */
  amount: number | null;
  comment: string | null;
  approvedByName: string | null;
  approvedAt: string | null; // ISO
  canAttest: boolean;
}

export interface SupplierInvoiceLineView {
  id: string;
  account: string;
  accountName: string | null;
  costCenterCode: string | null;
  project: string | null;
  description: string | null;
  debit: number; // SEK
  credit: number; // SEK
}

export interface SupplierInvoiceEventView {
  id: string;
  type: SupplierInvoiceEventType;
  actor: string | null;
  /** Who, for their picture. Null with `actor`. */
  actorId: string | null;
  comment: string | null;
  /** For ASSIGNED: the unit it went to, by name as it was then. */
  toUnit: string | null;
  /** For an ASSIGNED made without anybody: which rule, and what it matched. */
  auto: { rule: AutoRule; match: string } | null;
  date: string; // ISO
}

export interface InvoiceMailView {
  fromAddress: string;
  fromName: string | null;
  subject: string | null;
  note: string | null;
  originalFrom: string | null;
  receivedAt: string; // ISO
}

export interface SupplierInvoiceView {
  id: string;
  /** "LEV26-0012". */
  reference: string | null;
  status: SupplierInvoiceStatus;
  source: SupplierInvoiceSource;
  description: string | null;
  supplierName: string | null;
  supplierOrgNo: string | null;
  invoiceNumber: string | null;
  invoiceDate: string;
  dueDate: string;
  amount: number | null; // SEK
  /** Öresutjämning, SEK, signed. See bookedShares. */
  rounding: number | null;
  currency: string;
  ocr: string | null;
  bankgiro: string | null;
  plusgiro: string | null;
  /** "Er referens", as the PDF printed it or the treasurer corrected it. */
  yourReference: string | null;
  /** "Vår referens", written at the booking. */
  ourReference: string | null;
  /** Which fields were read from the PDF rather than typed. */
  prefilled: string[];
  fortnoxSupplierNumber: string | null;
  fortnoxGivenNumber: string | null;
  exportedAt: string | null;
  /** Set while an export holds the lock. UNCERTAIN is the one to act on: the
   *  treasurer has to look in Fortnox and say whether it was made. */
  exportState: "CLAIMED" | "SENT" | "UNCERTAIN" | null;
  /** The picked Fortnox supplier as the app's copy of the register has it,
   *  for the giro check on the record before it is sent. */
  register: { name: string; bankgiro: string | null; plusgiro: string | null } | null;
  /** Account to start each line on, by allocation id, for an attested invoice with no kontering: the supplier's last booking, same cost centre if any. */
  suggestedAccounts: Record<string, string>;
  resultUnitId: string | null;
  resultUnitName: string | null;
  receivedByName: string | null;
  receivedAt: string;
  mail: InvoiceMailView | null;
  /** The cost centre the fördelning opens on: named in the mail or PDF "Er referens", else the supplier's last invoice's, else the unit's only one. */
  suggestedCostCenter: string | null;
  allocations: SupplierInvoiceAllocationView[];
  lines: SupplierInvoiceLineView[];
  documents: { id: string; filename: string; mimeType: string }[];
  events: SupplierInvoiceEventView[];
  updatedAt: string;
}

function assignedTo(diff: unknown): string | null {
  const to = (diff as { to?: unknown } | null)?.to;
  return typeof to === "string" ? to : null;
}

const AUTO_RULES: readonly AutoRule[] = ["costCenter", "unitName", "forwarder"];

function autoOf(diff: unknown): { rule: AutoRule; match: string } | null {
  const d = diff as { auto?: unknown; match?: unknown } | null;
  return AUTO_RULES.includes(d?.auto as AutoRule) && typeof d?.match === "string"
    ? { rule: d.auto as AutoRule, match: d.match }
    : null;
}

/** Which cost centre to offer for the kontering (order: see suggestedCostCenter). Only ever the invoice's own unit's. */
export async function costCenterSuggestionFor(inv: {
  id: string;
  resultUnitId: string | null;
  supplierName: string | null;
  yourReference: string | null;
  inboundMail: {
    note: string | null;
    subject: string | null;
    originalFrom: string | null;
  } | null;
}): Promise<string | null> {
  if (!inv.resultUnitId) return null;
  const prefixes = (await getPrefixes()).filter((p) => p.resultUnitId === inv.resultUnitId);
  if (prefixes.length === 0) return null;
  const centres = await prisma.costCenter.findMany({
    where: { active: true, ...costCentreWhereForPrefixes(prefixes.map((p) => p.value)) },
    orderBy: [{ code: "asc" }],
    select: { code: true },
  });
  const codes = new Set(centres.map((c) => c.code));

  const text = [inv.inboundMail?.note, inv.inboundMail?.subject, inv.yourReference]
    .filter(Boolean)
    .join("\n")
    .toUpperCase();
  const named = (text.match(/\b[A-ZÅÄÖ]{2,8}\d{1,4}\b/g) ?? []).find((c) => codes.has(c));
  if (named) return named;

  const from = inv.inboundMail?.originalFrom;
  const sameSupplier: Prisma.SupplierInvoiceWhereInput[] = [];
  if (from) sameSupplier.push({ inboundMail: { originalFrom: from } });
  if (inv.supplierName) sameSupplier.push({ supplierName: inv.supplierName });
  if (sameSupplier.length) {
    const prior = await prisma.supplierInvoiceAllocation.findFirst({
      where: {
        invoice: { id: { not: inv.id }, OR: sameSupplier },
        costCenter: { code: { in: [...codes] } },
      },
      orderBy: [{ invoice: { createdAt: "desc" } }, { position: "asc" }],
      select: { costCenter: { select: { code: true } } },
    });
    if (prior) return prior.costCenter.code;
  }

  return centres.length === 1 ? centres[0].code : null;
}

/** See suggestedAccounts on SupplierInvoiceView. Matched on Fortnox supplier, else org number, else name. */
async function accountSuggestionsFor(inv: {
  id: string;
  fortnoxSupplierNumber: string | null;
  supplierOrgNo: string | null;
  supplierName: string | null;
  lines: unknown[];
  allocations: { id: string; costCenter: { code: string } }[];
}): Promise<Record<string, string>> {
  if (inv.lines.length > 0 || inv.allocations.length === 0) return {};
  const same: Prisma.SupplierInvoiceWhereInput[] = [];
  if (inv.fortnoxSupplierNumber) same.push({ fortnoxSupplierNumber: inv.fortnoxSupplierNumber });
  if (inv.supplierOrgNo) same.push({ supplierOrgNo: inv.supplierOrgNo });
  if (inv.supplierName) same.push({ supplierName: inv.supplierName });
  if (same.length === 0) return {};
  const prior = await prisma.supplierInvoiceLine.findMany({
    where: { debit: { gt: 0 }, invoice: { id: { not: inv.id }, OR: same } },
    orderBy: [{ invoice: { createdAt: "desc" } }, { position: "asc" }],
    take: 50,
    select: { account: true, costCenterCode: true },
  });
  if (prior.length === 0) return {};
  return Object.fromEntries(
    inv.allocations.map((a) => [
      a.id,
      (prior.find((p) => p.costCenterCode === a.costCenter.code) ?? prior[0]).account,
    ]),
  );
}

/** One invoice and what the viewer may do with it, or null when absent or out of reach (the same answer on purpose). */
export async function getInvoice(
  id: string,
  viewer: Viewer,
  /** What its PDF says, for the cost centre suggestion before anything is saved. */
  reading?: DocumentReading,
): Promise<{ invoice: SupplierInvoiceView; can: InvoiceCapabilities } | null> {
  const v = await invoiceViewerOf(viewer);
  const inv = await prisma.supplierInvoice.findFirst({
    where: { AND: [{ id }, invoiceScopeWhere(v)] },
    include: {
      receivedBy: { select: { name: true } },
      resultUnit: { select: { name: true } },
      inboundMail: {
        select: {
          fromAddress: true,
          fromName: true,
          subject: true,
          note: true,
          originalFrom: true,
          receivedAt: true,
        },
      },
      allocations: {
        orderBy: [{ position: "asc" }, { id: "asc" }],
        include: {
          costCenter: { select: { code: true, name: true } },
          approvedBy: { select: { name: true } },
        },
      },
      lines: { orderBy: [{ position: "asc" }, { id: "asc" }] },
      documents: {
        orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        select: { id: true, filename: true, mimeType: true },
      },
      events: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        include: { actor: { select: { id: true, name: true } } },
      },
    },
  });
  if (!inv) return null;

  // Account names, looked up once for every row (the column is a plain number). See SupplierInvoiceAllocation.account.
  const numbers = [
    ...new Set([
      ...inv.allocations.flatMap((a) => (a.account ? [a.account] : [])),
      ...inv.lines.map((l) => l.account),
    ]),
  ];
  const accounts = numbers.length
    ? await prisma.account.findMany({
        where: { number: { in: numbers } },
        select: { number: true, name: true },
      })
    : [];
  const accountName = new Map(accounts.map((a) => [a.number, a.name]));

  const facts = invoiceFactsOf(v, inv);
  const can = invoiceCapabilities(v, facts);
  const m = inv.inboundMail;
  const suggestedCostCenter =
    can.canAllocate && inv.allocations.length === 0
      ? await costCenterSuggestionFor({
          ...inv,
          yourReference: inv.yourReference ?? reading?.fields.reference ?? null,
          supplierName: inv.supplierName ?? reading?.supplier?.name ?? null,
        })
      : null;
  const suggestedAccounts = can.canBook ? await accountSuggestionsFor(inv) : {};
  const register = inv.fortnoxSupplierNumber
    ? await prisma.supplier.findUnique({
        where: { number: inv.fortnoxSupplierNumber },
        select: { name: true, bankgiro: true, plusgiro: true },
      })
    : null;
  return {
    can,
    invoice: {
      id: inv.id,
      reference: inv.reference,
      status: inv.status,
      source: inv.source,
      description: inv.description,
      supplierName: inv.supplierName,
      supplierOrgNo: inv.supplierOrgNo,
      invoiceNumber: inv.invoiceNumber,
      invoiceDate: isoDate(inv.invoiceDate),
      dueDate: isoDate(inv.dueDate),
      amount: inv.amount == null ? null : ore(inv.amount),
      rounding: inv.rounding == null ? null : ore(inv.rounding),
      currency: inv.currency,
      ocr: inv.ocr,
      bankgiro: inv.bankgiro,
      plusgiro: inv.plusgiro,
      yourReference: inv.yourReference,
      ourReference: inv.ourReference,
      prefilled: inv.prefilled,
      fortnoxSupplierNumber: inv.fortnoxSupplierNumber,
      fortnoxGivenNumber: inv.fortnoxGivenNumber,
      exportedAt: inv.exportedAt?.toISOString() ?? null,
      exportState: inv.exportClaimState,
      suggestedAccounts,
      register,
      resultUnitId: inv.resultUnitId,
      resultUnitName: inv.resultUnit?.name ?? null,
      receivedByName: inv.receivedBy?.name ?? null,
      receivedAt: inv.createdAt.toISOString(),
      mail: m
        ? {
            fromAddress: m.fromAddress,
            fromName: m.fromName,
            subject: m.subject,
            note: m.note,
            originalFrom: m.originalFrom,
            receivedAt: m.receivedAt.toISOString(),
          }
        : null,
      suggestedCostCenter,
      allocations: inv.allocations.map((a, i) => ({
        id: a.id,
        costCenterCode: a.costCenter.code,
        costCenterName: a.costCenter.name,
        resultUnit: resultUnitNameForCode(a.costCenter.code, v.prefixes),
        account: a.account,
        accountName: a.account ? (accountName.get(a.account) ?? null) : null,
        project: a.project,
        amount: a.amount == null ? null : ore(a.amount),
        comment: a.comment,
        approvedByName: a.approvedBy?.name ?? null,
        approvedAt: a.approvedAt?.toISOString() ?? null,
        canAttest: facts.allocations[i].viewerMayAttest,
      })),
      lines: inv.lines.map((l) => ({
        id: l.id,
        account: l.account,
        accountName: accountName.get(l.account) ?? null,
        costCenterCode: l.costCenterCode,
        project: l.project,
        description: l.description,
        debit: ore(l.debit),
        credit: ore(l.credit),
      })),
      documents: inv.documents,
      events: inv.events.map((e) => ({
        id: e.id,
        type: e.type,
        actor: e.actor?.name ?? null,
        actorId: e.actor?.id ?? null,
        comment: e.comment,
        toUnit: e.type === "ASSIGNED" ? assignedTo(e.diff) : null,
        auto: e.type === "ASSIGNED" ? autoOf(e.diff) : null,
        date: e.createdAt.toISOString(),
      })),
      updatedAt: inv.updatedAt.toISOString(),
    },
  };
}

export interface InboxHealth {
  enabled: boolean;
  address: string | null;
  /** Whether a login to the mailbox is stored. Nothing is read until there is one. */
  connected: boolean;
  connectedBy: string | null;
  connectedAt: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  watchExpiresAt: string | null;
  rejected: {
    id: string;
    fromAddress: string;
    subject: string | null;
    reason: string | null;
    receivedAt: string;
  }[];
}

export async function getInboxHealth(): Promise<InboxHealth> {
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const [state, rejected] = await Promise.all([
    prisma.gmailSync.findUnique({
      where: { id: "singleton" },
      include: { connectedBy: { select: { name: true } } },
    }),
    prisma.inboundMail.findMany({
      where: { status: "REJECTED", createdAt: { gte: since } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 10,
      select: {
        id: true,
        fromAddress: true,
        subject: true,
        rejectReason: true,
        receivedAt: true,
      },
    }),
  ]);
  const config = gmailConfig();
  return {
    enabled: config !== null,
    address: config?.mailbox ?? null,
    connected: Boolean(state?.refreshToken),
    connectedBy: state?.connectedBy?.name ?? null,
    connectedAt: state?.connectedAt?.toISOString() ?? null,
    lastSyncAt: state?.lastSyncAt?.toISOString() ?? null,
    lastError: state?.lastError ?? null,
    watchExpiresAt: state?.watchExpiresAt?.toISOString() ?? null,
    rejected: rejected.map((r) => ({
      id: r.id,
      fromAddress: r.fromAddress,
      subject: r.subject,
      reason: r.rejectReason,
      receivedAt: r.receivedAt.toISOString(),
    })),
  };
}

export async function getAssignableResultUnits(): Promise<{ id: string; name: string }[]> {
  return prisma.resultUnit.findMany({
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: { id: true, name: true },
  });
}
