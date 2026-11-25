import "server-only";

// The board's year-end invoices: one customer invoice per member for what they took from the café stock, at
// board price, made in Fortnox as an utkast. See docs/stock.md. Each goes to a customer the treasurer picks from
// Fortnox's register. The app never makes customers: one that is missing is added in Fortnox first.
//
// An invoice is first written down here with its lines, and the withdrawals are pointed at it. From then on they
// are locked. Sending it is a separate step that can be run again: it always looks in Fortnox for an invoice
// carrying our id before it makes one, so a button pressed twice, or again after a lost answer, sends nothing twice.
// One that does not get there stays on the member's closed tabs, to be sent again from its row.

import { getBoardWithdrawals, BOARD_STOCK } from "@/lib/data/board";
import { getStockSettings } from "@/lib/data/stock-settings";
import { isoDay, today } from "@/lib/domain/date";
import { oreToSEK } from "@/lib/domain/money";
import { sendableCostCenter } from "@/lib/domain/cost-center-tag";
import {
  createCustomerInvoice,
  findCustomerInvoice,
  getServiceToken,
  refusedByFortnox,
} from "@/lib/fortnox";
import type { FiscalYear } from "@/lib/ui/fiscal-year";
import { prisma } from "./db";

export interface BoardInvoiceLineDto {
  description: string;
  qty: number;
  unitPriceOre: number;
  amountOre: number;
}

/** What one member would be, or has been, invoiced for a year. */
export interface BoardInvoicePreview {
  memberId: string;
  memberName: string;
  email: string;
  /** The Fortnox customer used for them last time, picked again by default. */
  customerNumber: string | null;
  /** What is not on an invoice yet. Empty when there is nothing new. */
  lines: BoardInvoiceLineDto[];
  totalOre: number;
  /** Invoices already made for the year, sent or waiting to be. */
  invoices: {
    id: string;
    totalOre: number;
    /** Fortnox's number, or null while it has not reached Fortnox. */
    documentNumber: string | null;
  }[];
}

/** Withdrawals as invoice lines: one per product and price, so a price change mid-year shows as two lines. */
function groupLines(
  rows: { productName: string; qty: number; unitPriceOre: number }[],
): BoardInvoiceLineDto[] {
  const by = new Map<string, BoardInvoiceLineDto>();
  for (const r of rows) {
    const key = `${r.productName}|${r.unitPriceOre}`;
    const held = by.get(key) ?? {
      description: r.productName,
      qty: 0,
      unitPriceOre: r.unitPriceOre,
      amountOre: 0,
    };
    held.qty += r.qty;
    held.amountOre += r.qty * r.unitPriceOre;
    by.set(key, held);
  }
  return [...by.values()].sort((a, b) => a.description.localeCompare(b.description, "sv"));
}

/** Every member with something for the year: what is still to invoice, and what already has been. */
export async function previewBoardInvoices(year: FiscalYear): Promise<BoardInvoicePreview[]> {
  const [open, made] = await Promise.all([
    getBoardWithdrawals({ invoiced: false, from: year.fromDate, to: year.toDate }),
    prisma.customerInvoice.findMany({
      where: { source: "BOARD_TAB", fiscalYearId: year.id },
      orderBy: { sequence: "asc" },
      select: {
        id: true,
        customerId: true,
        totalOre: true,
        fortnoxDocumentNumber: true,
        customer: { select: { name: true } },
      },
    }),
  ]);

  const members = new Map<string, BoardInvoicePreview>();
  const of = (id: string, name: string) => {
    const held = members.get(id) ?? {
      memberId: id,
      memberName: name,
      email: "",
      customerNumber: null,
      lines: [],
      totalOre: 0,
      invoices: [],
    };
    members.set(id, held);
    return held;
  };
  const byMember = new Map<string, typeof open>();
  for (const w of open) byMember.set(w.memberId, [...(byMember.get(w.memberId) ?? []), w]);
  for (const [id, rows] of byMember) {
    const m = of(id, rows[0].memberName);
    m.lines = groupLines(rows);
    m.totalOre = m.lines.reduce((sum, l) => sum + l.amountOre, 0);
  }
  for (const inv of made) {
    of(inv.customerId, inv.customer.name).invoices.push({
      id: inv.id,
      totalOre: inv.totalOre,
      documentNumber: inv.fortnoxDocumentNumber,
    });
  }
  const users = await prisma.user.findMany({
    where: { id: { in: [...members.keys()] } },
    select: { id: true, email: true, fortnoxCustomerNumber: true },
  });
  for (const u of users) {
    const m = members.get(u.id)!;
    m.email = u.email;
    m.customerNumber = u.fortnoxCustomerNumber;
  }
  return [...members.values()].sort((a, b) => a.memberName.localeCompare(b.memberName, "sv"));
}

/** A refusal of ours rather than Fortnox's. `code` is a key under `errors` in messages/. */
export class BoardInvoiceError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export interface BoardInvoiceRunResult {
  sent: { memberName: string; documentNumber: string }[];
  failed: { memberName: string; error: string }[];
}

/**
 * Write down an invoice for everything a member has taken in the year that is not on one yet. Returns its id,
 * or null when there is nothing new. The withdrawals are locked from here.
 */
async function draftInvoice(
  memberId: string,
  year: FiscalYear,
  account: string,
  costCenterId: string | null,
  actorId: string,
): Promise<string | null> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.boardWithdrawal.findMany({
      where: {
        memberId,
        invoiceLineId: null,
        entry: { occurredAt: { gte: new Date(year.fromDate), lte: new Date(year.toDate) } },
      },
      select: {
        id: true,
        qty: true,
        unitPriceOre: true,
        entry: { select: { product: { select: { name: true } } } },
      },
    });
    if (rows.length === 0) return null;

    const lines = groupLines(
      rows.map((r) => ({
        productName: r.entry.product.name,
        qty: r.qty,
        unitPriceOre: r.unitPriceOre,
      })),
    );
    const last = await tx.customerInvoice.aggregate({
      where: { source: "BOARD_TAB", customerId: memberId, fiscalYearId: year.id },
      _max: { sequence: true },
    });
    const invoice = await tx.customerInvoice.create({
      data: {
        source: "BOARD_TAB",
        customerId: memberId,
        fiscalYearId: year.id,
        sequence: last._max.sequence == null ? 0 : last._max.sequence + 1,
        invoiceDate: new Date(today()),
        totalOre: lines.reduce((sum, l) => sum + l.amountOre, 0),
        createdById: actorId,
        lines: {
          create: lines.map((l, i) => ({ ...l, account, costCenterId, sortOrder: i })),
        },
      },
      select: { id: true, lines: { select: { id: true, description: true, unitPriceOre: true } } },
    });
    // Each withdrawal on the line it was added into.
    for (const line of invoice.lines) {
      await tx.boardWithdrawal.updateMany({
        where: {
          id: {
            in: rows
              .filter(
                (r) =>
                  r.entry.product.name === line.description && r.unitPriceOre === line.unitPriceOre,
              )
              .map((r) => r.id),
          },
        },
        data: { invoiceLineId: line.id },
      });
    }
    return invoice.id;
  });
}

/**
 * Send one written-down invoice to Fortnox, to the customer picked for it, or find that it is already there.
 * Safe to run again. One that may already be in Fortnox stays with the customer it was sent to.
 */
async function sendInvoice(
  invoiceId: string,
  pickedCustomer: string,
  actorId: string,
  userToken: string,
): Promise<string> {
  const invoice = await prisma.customerInvoice.findUniqueOrThrow({
    where: { id: invoiceId },
    include: { lines: { orderBy: { sortOrder: "asc" }, include: { costCenter: true } } },
  });
  if (invoice.fortnoxDocumentNumber) return invoice.fortnoxDocumentNumber;

  const customerNumber =
    invoice.exportClaimState === "UNCERTAIN" && invoice.fortnoxCustomerNumber
      ? invoice.fortnoxCustomerNumber
      : pickedCustomer;
  // Picked again by default next time.
  await prisma.user.update({
    where: { id: invoice.customerId },
    data: { fortnoxCustomerNumber: customerNumber },
  });

  const record = (documentNumber: string) =>
    prisma.customerInvoice.update({
      where: { id: invoice.id },
      data: {
        fortnoxCustomerNumber: customerNumber,
        fortnoxDocumentNumber: documentNumber,
        exportedAt: new Date(),
        exportedById: actorId,
        exportClaimedAt: null,
        exportClaimState: null,
      },
    });

  // Already there, from a run whose answer was lost: take its number and make nothing.
  const existing = await findCustomerInvoice(await getServiceToken(), customerNumber, invoice.id);
  if (existing) {
    await record(existing);
    return existing;
  }

  await prisma.customerInvoice.update({
    where: { id: invoice.id },
    data: {
      exportClaimedAt: new Date(),
      exportClaimState: "SENT",
      fortnoxCustomerNumber: customerNumber,
    },
  });
  let documentNumber;
  try {
    documentNumber = await createCustomerInvoice(userToken, {
      customerNumber,
      invoiceDate: isoDay(invoice.invoiceDate),
      externalReference: invoice.id,
      rows: invoice.lines.map((l) => ({
        account: Number(l.account),
        description: l.description,
        quantity: l.qty,
        price: oreToSEK(l.unitPriceOre),
        // The shared rule for what may travel as a cost centre. The code is not tagged onto the
        // text here, unlike a voucher's: an invoice row's text is printed for the member to read.
        costCenter: sendableCostCenter(l.costCenter),
      })),
    });
  } catch (e) {
    const refused = refusedByFortnox(e);
    await prisma.customerInvoice.update({
      where: { id: invoice.id },
      // A plain refusal made nothing. Anything else is left flagged, and the next try looks in Fortnox first.
      data: refused
        ? { exportClaimedAt: null, exportClaimState: null }
        : { exportClaimState: "UNCERTAIN" },
    });
    throw e;
  }
  await record(documentNumber);
  return documentNumber;
}

/** What may be changed on an invoice before it is sent again: whatever made Fortnox refuse it. */
export interface BoardInvoiceChanges {
  /** The Fortnox customer it goes to. Needed when none was picked for the member before. */
  customerNumber?: string;
  account?: string;
  costCenterId?: string | null;
  invoiceDate?: string;
}

/**
 * Send one board invoice again from its row, after a run that did not get it to Fortnox, with the changes made
 * first. Null when there is no such board invoice. A failure throws and the invoice stays, to be tried again.
 */
export async function resendBoardInvoice(
  invoiceId: string,
  actorId: string,
  userToken: string,
  changes: BoardInvoiceChanges = {},
): Promise<string | null> {
  const found = await prisma.customerInvoice.findFirst({
    where: { id: invoiceId, source: "BOARD_TAB" },
    select: {
      id: true,
      fortnoxDocumentNumber: true,
      fortnoxCustomerNumber: true,
      customer: { select: { fortnoxCustomerNumber: true } },
    },
  });
  if (!found) return null;
  const customerNumber =
    changes.customerNumber ?? found.fortnoxCustomerNumber ?? found.customer.fortnoxCustomerNumber;
  if (!customerNumber) throw new BoardInvoiceError("board.customerMissing");
  // Once in Fortnox it is changed there, not here.
  if (!found.fortnoxDocumentNumber) {
    const { account, costCenterId, invoiceDate } = changes;
    await prisma.$transaction([
      ...(invoiceDate
        ? [
            prisma.customerInvoice.update({
              where: { id: found.id },
              data: { invoiceDate: new Date(invoiceDate) },
            }),
          ]
        : []),
      ...(account !== undefined || costCenterId !== undefined
        ? [
            prisma.customerInvoiceLine.updateMany({
              where: { invoiceId: found.id },
              data: { account, costCenterId },
            }),
          ]
        : []),
    ]);
  }
  return sendInvoice(found.id, customerNumber, actorId, userToken);
}

/**
 * The one button: for each member, write down an invoice for what is new in the year and send every invoice of
 * theirs that has not reached Fortnox. Members are independent, so one that fails does not stop the rest.
 */
export async function runBoardInvoices(
  year: FiscalYear,
  actorId: string,
  userToken: string,
  /** The Fortnox customer picked for each member, by member id. */
  customers: Readonly<Record<string, string>>,
  memberIds?: readonly string[],
): Promise<BoardInvoiceRunResult | { error: string }> {
  const settings = await getStockSettings(BOARD_STOCK);
  if (!settings.boardSalesAccount) return { error: "board.salesAccountUnset" };

  const preview = (await previewBoardInvoices(year)).filter(
    (m) => !memberIds || memberIds.includes(m.memberId),
  );
  // Nothing is written down for anybody until everybody has a customer.
  const customerOf = (m: BoardInvoicePreview) => customers[m.memberId] ?? m.customerNumber;
  if (preview.some((m) => !customerOf(m))) return { error: "board.customerMissing" };

  const result: BoardInvoiceRunResult = { sent: [], failed: [] };
  for (const member of preview) {
    try {
      const fresh =
        member.lines.length > 0
          ? await draftInvoice(
              member.memberId,
              year,
              settings.boardSalesAccount,
              settings.boardSalesCostCenterId,
              actorId,
            )
          : null;
      const pending = [
        ...member.invoices.filter((i) => !i.documentNumber).map((i) => i.id),
        ...(fresh ? [fresh] : []),
      ];
      for (const id of pending) {
        const documentNumber = await sendInvoice(id, customerOf(member)!, actorId, userToken);
        result.sent.push({ memberName: member.memberName, documentNumber });
      }
    } catch (e) {
      console.error(`[board] invoice for ${member.memberId} failed`, e);
      result.failed.push({
        memberName: member.memberName,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return result;
}
