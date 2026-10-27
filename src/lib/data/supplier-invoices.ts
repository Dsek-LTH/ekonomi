// Leverantörsfakturor as the screens read them: which ones a viewer may see,
// the list, and one invoice with everything its page needs.
//
// Who may see what, stated once:
//
//   • triage and the bookkeeping roles see every invoice, the inkorg included;
//   • a resultatansvarig sees the invoices given to a unit they answer for, and
//     any invoice konterad onto one of their cost centres, since that is one
//     they may be asked to sign;
//   • nobody else sees any.
//
// The same rule answers both a list and a single invoice, the second by asking
// for the first narrowed to one id. A rule written twice is a rule that drifts.
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
  invoiceWaitsOn,
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
import type { Viewer } from "./expense-scope";
import { isoDate } from "./shared";

// ── Who is asking ─────────────────────────────────────────────────

/** Everything the rules need to know about a viewer, and what attesting needs
 *  besides: the unit names, since that is what canAttestAllocation compares. */
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
  // The ids behind the names, from the prefix table already in hand. A unit
  // with no prefixes is not in it, so it is looked up; that is the rare case.
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

/** Whether the viewer sees every invoice there is. */
const seesEverything = (v: InvoiceViewer) =>
  canTriageInvoices(v.capabilities) ||
  canViewBookkeeping(v.capabilities) ||
  isAdmin(v.capabilities);

/**
 * The viewer's reach as a filter. Somebody with no reach at all gets a filter
 * that matches nothing, rather than an empty `OR`, which Prisma reads as no
 * filter and so as everything.
 */
export function invoiceScopeWhere(v: InvoiceViewerCtx): Prisma.SupplierInvoiceWhereInput {
  if (seesEverything(v)) return {};

  const OR: Prisma.SupplierInvoiceWhereInput[] = [];
  if (v.ownedResultUnitIds.length) OR.push({ resultUnitId: { in: [...v.ownedResultUnitIds] } });
  if (v.ownedPrefixes.length) {
    OR.push({ allocations: { some: { costCenter: costCentreWhereForPrefixes(v.ownedPrefixes) } } });
  }
  if (OR.length === 0) return { id: { in: [] } };
  // The inkorg and what was thrown out of it are triage's business. An
  // invoice discarded after it was given to a unit is still not theirs to
  // read about.
  return { AND: [{ status: { notIn: ["INBOX", "DISCARDED"] } }, { OR }] };
}

/** Whether the viewer may attest one allocation, by the utlägg rule. */
function mayAttest(v: InvoiceViewerCtx, costCenterCode: string): boolean {
  return canAttestAllocation({
    actorCapabilities: v.capabilities,
    actorRoles: v.roles,
    // Nobody is claiming money on an invoice, so nobody is excluded as its
    // submitter. See the note at the top of lib/domain/supplier-invoice.ts.
    actorIsSubmitter: false,
    actorOwnedResultUnits: v.ownedResultUnitNames,
    allocationResultUnit: resultUnitNameForCode(costCenterCode, v.prefixes),
  });
}

/** The rules' view of one invoice, from rows already loaded. */
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
      viewerMayAttest: mayAttest(v, a.costCenter.code),
    })),
  };
}

// ── The list ──────────────────────────────────────────────────────

export interface SupplierInvoiceRow {
  id: string;
  status: SupplierInvoiceStatus;
  source: SupplierInvoiceSource;
  supplierName: string | null;
  invoiceNumber: string | null;
  description: string | null;
  amount: number | null; // SEK
  dueDate: string; // YYYY-MM-DD, or "" when not filled in
  receivedAt: string; // ISO
  receivedByName: string | null;
  resultUnitName: string | null;
  /** Something the viewer has to do: sort it, kontera it, or sign it. */
  waitsOnViewer: boolean;
}

const ROW_SELECT = {
  id: true,
  status: true,
  source: true,
  supplierName: true,
  invoiceNumber: true,
  description: true,
  amount: true,
  dueDate: true,
  createdAt: true,
  resultUnitId: true,
  receivedBy: { select: { name: true } },
  resultUnit: { select: { name: true } },
  allocations: { select: { approvedById: true, costCenter: { select: { code: true } } } },
} satisfies Prisma.SupplierInvoiceSelect;

/**
 * Every invoice the viewer may see, newest first.
 *
 * Not paged. An invoice is a few a week at most, and the screen filters in the
 * browser (ClientDataTable) the way the other lists of that size do. When
 * that stops being true it is this function that changes.
 */
export async function getInvoiceRows(viewer: Viewer): Promise<SupplierInvoiceRow[]> {
  const v = await invoiceViewerOf(viewer);
  const rows = await prisma.supplierInvoice.findMany({
    where: invoiceScopeWhere(v),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: ROW_SELECT,
  });
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    source: r.source,
    supplierName: r.supplierName,
    invoiceNumber: r.invoiceNumber,
    description: r.description,
    amount: r.amount == null ? null : ore(r.amount),
    dueDate: isoDate(r.dueDate),
    receivedAt: r.createdAt.toISOString(),
    receivedByName: r.receivedBy?.name ?? null,
    resultUnitName: r.resultUnit?.name ?? null,
    waitsOnViewer: invoiceWaitsOn(v, invoiceFactsOf(v, r)),
  }));
}

// ── One invoice ───────────────────────────────────────────────────

export interface SupplierInvoiceAllocationView {
  id: string;
  costCenterCode: string;
  costCenterName: string;
  resultUnit: string | null;
  account: string;
  accountName: string | null;
  project: string | null;
  amount: number; // SEK
  comment: string | null;
  approvedByName: string | null;
  approvedAt: string | null; // ISO
  canAttest: boolean;
}

export interface SupplierInvoiceEventView {
  id: string;
  type: SupplierInvoiceEventType;
  actor: string | null;
  comment: string | null;
  /** For ASSIGNED: the unit it went to, by name as it was then. */
  toUnit: string | null;
  /** For an ASSIGNED made without anybody: which rule, and what it matched. */
  auto: { rule: AutoRule; match: string } | null;
  date: string; // ISO
}

/** The mail an invoice came in, for one that was forwarded. */
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
  status: SupplierInvoiceStatus;
  source: SupplierInvoiceSource;
  description: string | null;
  supplierName: string | null;
  supplierOrgNo: string | null;
  invoiceNumber: string | null;
  invoiceDate: string;
  dueDate: string;
  amount: number | null; // SEK
  currency: string;
  ocr: string | null;
  bankgiro: string | null;
  plusgiro: string | null;
  resultUnitId: string | null;
  resultUnitName: string | null;
  receivedByName: string | null;
  receivedAt: string;
  mail: InvoiceMailView | null;
  /**
   * Where the last invoice from the same original sender went, offered to
   * triage for one still in the inkorg. A suggestion, never an assignment:
   * one supplier often serves several units. See autoAssign.
   */
  suggestedUnit: { id: string; name: string } | null;
  allocations: SupplierInvoiceAllocationView[];
  documents: { id: string; filename: string; mimeType: string }[];
  events: SupplierInvoiceEventView[];
  updatedAt: string;
}

/** The ASSIGNED event's `diff`, as it was written. */
function assignedTo(diff: unknown): string | null {
  const to = (diff as { to?: unknown } | null)?.to;
  return typeof to === "string" ? to : null;
}

const AUTO_RULES: readonly AutoRule[] = ["costCenter", "unitName", "forwarder"];

/** The automatic ASSIGNED event's reason, as lib/server/inbound-mail.ts wrote it. */
function autoOf(diff: unknown): { rule: AutoRule; match: string } | null {
  const d = diff as { auto?: unknown; match?: unknown } | null;
  return AUTO_RULES.includes(d?.auto as AutoRule) && typeof d?.match === "string"
    ? { rule: d.auto as AutoRule, match: d.match }
    : null;
}

/** Where the newest earlier invoice from this original sender was given. */
async function suggestionFor(
  invoiceId: string,
  originalFrom: string | null,
): Promise<{ id: string; name: string } | null> {
  if (!originalFrom) return null;
  const prior = await prisma.supplierInvoice.findFirst({
    where: {
      id: { not: invoiceId },
      resultUnitId: { not: null },
      status: { not: "DISCARDED" },
      inboundMail: { originalFrom },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { resultUnit: { select: { id: true, name: true } } },
  });
  return prior?.resultUnit ?? null;
}

/**
 * One invoice and what the viewer may do with it, or null when there is no
 * such invoice or it is outside what they may see. The two are the same
 * answer on purpose: an invoice that is not yours to read is not there.
 */
export async function getInvoice(
  id: string,
  viewer: Viewer,
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
      documents: {
        orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        select: { id: true, filename: true, mimeType: true },
      },
      events: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        include: { actor: { select: { name: true } } },
      },
    },
  });
  if (!inv) return null;

  // The account names, for showing what a number means. One lookup for every
  // row rather than a relation, because the column is a plain number. See
  // SupplierInvoiceAllocation.account.
  const numbers = [...new Set(inv.allocations.map((a) => a.account).filter(Boolean))];
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
  // Only where it would be acted on: triage, with the invoice still nobody's.
  const suggestedUnit =
    can.canAssign && !inv.resultUnitId ? await suggestionFor(inv.id, m?.originalFrom ?? null) : null;
  return {
    can,
    invoice: {
      id: inv.id,
      status: inv.status,
      source: inv.source,
      description: inv.description,
      supplierName: inv.supplierName,
      supplierOrgNo: inv.supplierOrgNo,
      invoiceNumber: inv.invoiceNumber,
      invoiceDate: isoDate(inv.invoiceDate),
      dueDate: isoDate(inv.dueDate),
      amount: inv.amount == null ? null : ore(inv.amount),
      currency: inv.currency,
      ocr: inv.ocr,
      bankgiro: inv.bankgiro,
      plusgiro: inv.plusgiro,
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
      suggestedUnit,
      allocations: inv.allocations.map((a, i) => ({
        id: a.id,
        costCenterCode: a.costCenter.code,
        costCenterName: a.costCenter.name,
        resultUnit: resultUnitNameForCode(a.costCenter.code, v.prefixes),
        account: a.account,
        accountName: accountName.get(a.account) ?? null,
        project: a.project,
        amount: ore(a.amount),
        comment: a.comment,
        approvedByName: a.approvedBy?.name ?? null,
        approvedAt: a.approvedAt?.toISOString() ?? null,
        canAttest: facts.allocations[i].viewerMayAttest,
      })),
      documents: inv.documents,
      events: inv.events.map((e) => ({
        id: e.id,
        type: e.type,
        actor: e.actor?.name ?? null,
        comment: e.comment,
        toUnit: e.type === "ASSIGNED" ? assignedTo(e.diff) : null,
        auto: e.type === "ASSIGNED" ? autoOf(e.diff) : null,
        date: e.createdAt.toISOString(),
      })),
      updatedAt: inv.updatedAt.toISOString(),
    },
  };
}

// ── The mailbox, for triage ───────────────────────────────────────

export interface InboxHealth {
  /** Whether the Gmail integration is configured at all. */
  enabled: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  watchExpiresAt: string | null;
  /** The latest refused mails, so a forward that went nowhere can be found. */
  rejected: {
    id: string;
    fromAddress: string;
    subject: string | null;
    reason: string | null;
    receivedAt: string;
  }[];
}

/** How the inkorg mailbox is doing, for the foot of triage's list. */
export async function getInboxHealth(): Promise<InboxHealth> {
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const [state, rejected] = await Promise.all([
    prisma.gmailSync.findUnique({ where: { id: "singleton" } }),
    prisma.inboundMail.findMany({
      where: { status: "REJECTED", createdAt: { gte: since } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 10,
      select: { id: true, fromAddress: true, subject: true, rejectReason: true, receivedAt: true },
    }),
  ]);
  return {
    enabled: gmailConfig() !== null,
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

/** The result units an invoice can be given to, for triage's picker. */
export async function getAssignableResultUnits(): Promise<{ id: string; name: string }[]> {
  return prisma.resultUnit.findMany({
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: { id: true, name: true },
  });
}
