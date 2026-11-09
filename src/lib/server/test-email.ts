// The test mail from Inställningar: a mail of a chosen kind, built from the member's real data by the same
// functions as the real one (lib/email/content.ts, weekly-digest.ts). "[Test]" stays in the subject so
// nobody acts on a change that never happened.
import "server-only";

import { prisma } from "@/lib/server/db";
import { attestersOf, holdersOf } from "@/lib/server/notify";
import { digestFor } from "@/lib/server/weekly-digest";
import { renderHtml, renderText, type Email } from "@/lib/email/render";
import {
  appUrl,
  emailT,
  expenseNotice,
  frame,
  invoiceNotice,
  transactionsBlock,
} from "@/lib/email/content";
import { loadUser } from "@/lib/server/current-user";
import { invoiceScopeWhere, invoiceViewerOf } from "@/lib/data/supplier-invoices";
import { REIMBURSEMENT_DEADLINE_DAYS } from "@/lib/domain/status";
import type { NotificationKind } from "@/lib/domain/types";

type ExpenseKey = Parameters<typeof expenseNotice>[0];

// Each mail about an utlägg by its content.ts key, and whose point of view it is written from.
const EXPENSE_KINDS: Partial<
  Record<NotificationKind, { key: ExpenseKey; reader: "submitter" | "attester" | "bookkeeper" }>
> = {
  EXPENSE_SUBMITTED: { key: "submitted", reader: "attester" },
  EXPENSE_RECALLED: { key: "recalled", reader: "attester" },
  EXPENSE_READY_TO_BOOK: { key: "readyToBook", reader: "bookkeeper" },
  EXPENSE_EXPORT_REVERTED: { key: "exportReverted", reader: "bookkeeper" },
  EXPENSE_CHANGES_REQUESTED: { key: "changesRequested", reader: "submitter" },
  EXPENSE_DEADLINE_WAIVER_REVOKED: { key: "waiverRevoked", reader: "submitter" },
  EXPENSE_COST_CENTER_APPROVED: { key: "costCenterApproved", reader: "submitter" },
  EXPENSE_APPROVED: { key: "approved", reader: "submitter" },
  EXPENSE_ATTEST_WITHDRAWN: { key: "attestWithdrawn", reader: "submitter" },
  EXPENSE_EXPORTED: { key: "exported", reader: "submitter" },
  EXPENSE_DEADLINE_WAIVED: { key: "waived", reader: "submitter" },
};

const EXPENSE_SELECT = {
  id: true,
  reference: true,
  title: true,
  grossAmount: true,
  purchaseDate: true,
  paymentType: true,
  submitterId: true,
  submitter: { select: { name: true } },
  allocations: { select: { costCenter: { select: { code: true, name: true } } } },
  // The latest comment, for the quote a real mail carries.
  events: {
    where: { comment: { not: null } },
    orderBy: { createdAt: "desc" as const },
    take: 1,
    select: { comment: true, actor: { select: { name: true } } },
  },
} as const;

// How far back to look for an utlägg waiting on this attester.
const ATTEST_SCAN = 25;

/**
 * Which utlägg a mail of this kind to this member is built on: only one they could open themselves.
 * attester: newest waiting for their attest. bookkeeper: newest attested or exported. Else their own newest.
 */
async function pickExpense(reader: "submitter" | "attester" | "bookkeeper", userId: string) {
  if (reader === "attester") {
    const pending = await prisma.expense.findMany({
      where: { status: "PENDING_APPROVAL", submitterId: { not: userId } },
      orderBy: { updatedAt: "desc" },
      take: ATTEST_SCAN,
      select: EXPENSE_SELECT,
    });
    for (const e of pending) {
      const ids = await attestersOf(
        e.allocations.map((a) => ({ costCenterCode: a.costCenter.code })),
        e.submitterId,
      );
      if (ids.includes(userId)) return e;
    }
  }
  if (reader === "bookkeeper" && (await holdersOf("BOOKKEEPING")).includes(userId)) {
    const booked = await prisma.expense.findFirst({
      where: { status: { in: ["APPROVED", "BOOKED", "EXPORTED"] } },
      orderBy: { updatedAt: "desc" },
      select: EXPENSE_SELECT,
    });
    if (booked) return booked;
  }
  return prisma.expense.findFirst({
    where: { submitterId: userId },
    orderBy: { updatedAt: "desc" },
    select: EXPENSE_SELECT,
  });
}

/** A card mail about the latest batch of transactions on this member's cards. */
async function cardEmail(userId: string): Promise<Email | null> {
  const latest = await prisma.bankTransaction.findFirst({
    where: { card: { holderId: userId } },
    orderBy: { importedAt: "desc" },
    select: { importedAt: true },
  });
  if (!latest) return null;
  // One import writes its rows in one statement, so they share the stamp.
  const txns = await prisma.bankTransaction.findMany({
    where: { card: { holderId: userId }, importedAt: latest.importedAt },
    select: {
      transactionDate: true,
      description: true,
      amount: true,
      card: { select: { last4: true } },
    },
  });
  const cards = [...new Set(txns.map((t) => t.card!.last4))]
    .map((l) => emailT("cardMask", { last4: l }))
    .join(", ");
  const count = txns.length;
  const url = appUrl("/bank?scope=mine");
  // Worded the way app/api/bank/import/route.ts words it.
  return {
    subject: emailT("cardTransactions.subject", { count }),
    tone: "card",
    eyebrow: emailT("cardTransactions.eyebrow", { cards }),
    heading: emailT("cardTransactions.heading", { count }),
    intro: emailT("cardTransactions.intro"),
    blocks: [transactionsBlock(txns, 30)],
    action: { label: emailT("cardTransactions.button"), url },
    orOpen: emailT("orOpen", { url }),
    ...frame(emailT("reason.cardHolder", { cards })),
  };
}

/** A levfaktura mail about the newest invoice this member may open. */
async function invoiceEmail(
  kind: "SUPPLIER_INVOICE_ASSIGNED" | "SUPPLIER_INVOICE_SUBMITTED",
  recipient: { id: string },
  sender: { name: string },
): Promise<Email | null> {
  const user = await loadUser(recipient.id);
  if (!user) return null;
  const scope = invoiceScopeWhere(await invoiceViewerOf({ id: recipient.id, ...user }));
  const inv = await prisma.supplierInvoice.findFirst({
    where: scope,
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    include: {
      resultUnit: { select: { name: true } },
      allocations: { select: { costCenter: { select: { code: true, name: true } } } },
    },
  });
  if (!inv) return null;
  return invoiceNotice(kind === "SUPPLIER_INVOICE_ASSIGNED" ? "assigned" : "submitted", inv, {
    actor: sender.name,
    unit: inv.resultUnit?.name ?? "",
  });
}

export type TestEmailResult =
  | { ok: true; id: string; subject: string }
  /** Nothing real to build this kind from, as an error code under `email.`. */
  | { ok: false; error: "noExpense" | "noCardTransactions" | "noInvoice" | "nothingWaiting" };

/**
 * Build a mail of `kind` for one member from their real data and write it to the outbox with `sentById`.
 * The member's profile choices are not asked: a test checks that mail reaches them at all.
 */
export async function sendTestEmail(
  kind: NotificationKind,
  recipient: { id: string; name: string },
  sender: { id: string; name: string },
): Promise<TestEmailResult> {
  let email: Email | null;
  const expenseKind = EXPENSE_KINDS[kind];

  if (expenseKind) {
    const e = await pickExpense(expenseKind.reader, recipient.id);
    if (!e) return { ok: false, error: "noExpense" };
    const note = e.events[0];
    // With a comment on the utlägg, its author is the actor; without one, the sender of the test.
    const actor = note?.actor?.name ?? sender.name;
    email = expenseNotice(
      expenseKind.key,
      e,
      {
        actor,
        submitter: e.submitter.name,
        costCenter: [
          ...new Set(e.allocations.map((a) => `${a.costCenter.code} - ${a.costCenter.name}`)),
        ].join(", "),
        days: REIMBURSEMENT_DEADLINE_DAYS,
      },
      note ? { author: actor, text: note.comment } : undefined,
    );
  } else if (kind === "CARD_TRANSACTIONS_IMPORTED") {
    email = await cardEmail(recipient.id);
    if (!email) return { ok: false, error: "noCardTransactions" };
  } else if (kind === "SUPPLIER_INVOICE_ASSIGNED" || kind === "SUPPLIER_INVOICE_SUBMITTED") {
    email = await invoiceEmail(kind, recipient, sender);
    if (!email) return { ok: false, error: "noInvoice" };
  } else {
    email = await digestFor(recipient);
    if (!email) return { ok: false, error: "nothingWaiting" };
  }

  const marked = { ...email, subject: emailT("testSubject", { subject: email.subject }) };
  const row = await prisma.outboundEmail.create({
    data: {
      kind,
      recipientId: recipient.id,
      sentById: sender.id,
      subject: marked.subject,
      text: renderText(marked),
      html: await renderHtml(marked),
    },
    select: { id: true, subject: true },
  });
  return { ok: true, ...row };
}
