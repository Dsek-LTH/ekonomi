// What each email says, as an `Email` (types.ts) for render.tsx. No database or request, so it serves
// lib/server/notify.ts and the React Email preview (emails/) alike.
import { createTranslator } from "next-intl";
import { oreToSEK } from "@/lib/domain/money";
import { formatSEK } from "@/lib/ui/format";
import { REIMBURSEMENT_DEADLINE_DAYS } from "@/lib/domain/status";
import type { ExpenseStatus, PaymentType } from "@/lib/domain/types";
import type { Block, Email, Tone } from "./types";
import svEmail from "../../../messages/sv/email.json";
import svCommon from "../../../messages/sv/common.json";
import { isoDay } from "@/lib/domain/date";
import { serverEnv } from "@/lib/server/env";

/** The address links in a mail point at. Absolute, since a mail is read outside the app. */
export function appUrl(path = "/"): string {
  return new URL(path, serverEnv("APP_URL")).toString();
}

// Swedish: a mail from a cron job cannot read the member's language cookie. Keep messages/en/email.json in step.
export const emailT = createTranslator({
  locale: "sv",
  messages: { email: svEmail },
  namespace: "email",
});

const commonT = createTranslator({
  locale: "sv",
  messages: { common: svCommon },
  namespace: "common",
});
const paymentLabel = (p: PaymentType): string => commonT(`payment.${p}.label`);
export const statusLabel = (s: ExpenseStatus): string => commonT(`status.${s}`);

const signedSek = new Intl.NumberFormat("sv-SE", {
  style: "currency",
  currency: "SEK",
  signDisplay: "exceptZero",
});

export const formatOre = (ore: number): string => formatSEK(oreToSEK(ore));

/** A bank amount, signed both ways, so a refund reads as money coming back. */
export const formatSignedOre = (ore: number): string => signedSek.format(oreToSEK(ore));

const stockholmMinute = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Stockholm",
  dateStyle: "short",
  timeStyle: "short",
});

/** What an utlägg is called in a mail: reference and title, or only the title for a draft. */
export const mailLabel = (e: { reference: string | null; title: string }): string =>
  e.reference ? `${e.reference} - ${e.title}` : e.title;

export function frame(
  reason: string,
  settings: "settings" | "settingsDigest" = "settings",
): Pick<Email, "footer" | "brand"> {
  return {
    footer: {
      reason,
      settings: { label: emailT(settings), url: appUrl("/profile") },
      org: emailT("org"),
    },
    brand: { name: emailT("brand"), org: emailT("org") },
  };
}

type ExpenseKind =
  | "submitted"
  | "changesRequested"
  | "waiverRevoked"
  | "waived"
  | "costCenterApproved"
  | "approved"
  | "readyToBook"
  | "attestWithdrawn"
  | "recalled"
  | "exported"
  | "exportReverted";

// Amber is for mails saying something went backwards that the reader must fix or check; the rest carry the brand pink.
const EXPENSE_KINDS: Record<
  ExpenseKind,
  { tone: Tone; reason: "attester" | "submitter" | "bookkeeper" }
> = {
  submitted: { tone: "action", reason: "attester" },
  changesRequested: { tone: "warning", reason: "submitter" },
  waiverRevoked: { tone: "warning", reason: "submitter" },
  waived: { tone: "action", reason: "submitter" },
  costCenterApproved: { tone: "action", reason: "submitter" },
  approved: { tone: "action", reason: "submitter" },
  readyToBook: { tone: "action", reason: "bookkeeper" },
  attestWithdrawn: { tone: "warning", reason: "submitter" },
  recalled: { tone: "action", reason: "attester" },
  exported: { tone: "action", reason: "submitter" },
  exportReverted: { tone: "warning", reason: "bookkeeper" },
};

/** What a mail about an utlägg can say about it. Only id, reference, title and amount are required. */
export interface ExpenseFacts {
  id: string;
  reference: string | null;
  title: string;
  grossAmount: number | null;
  purchaseDate?: Date | null;
  paymentType?: PaymentType;
  allocations?: { costCenter: { code: string; name: string } }[];
}

/** The mail about one utlägg. A comment from the actor is quoted above it, being usually the reason for the mail. */
export function expenseNotice(
  key: ExpenseKind,
  expense: ExpenseFacts,
  values: Record<string, string | number> = {},
  comment?: { author: string; text: string | null },
): Email {
  const { tone, reason } = EXPENSE_KINDS[key];
  const label = mailLabel(expense);
  const url = appUrl(`/expenses/${expense.id}`);

  return {
    subject: emailT(`${key}.subject`, { label }),
    tone,
    eyebrow: emailT(`${key}.eyebrow`),
    heading: emailT(`${key}.heading`, values),
    intro: emailT(`${key}.intro`, values),
    blocks: [...commentBlock(comment), expenseBlock(expense)],
    action: { label: emailT(`${key}.button`), url },
    orOpen: emailT("orOpen", { url }),
    ...frame(emailT(`reason.${reason}`)),
  };
}

/** One utlägg as a mail shows it. */
function expenseBlock(expense: ExpenseFacts): Block {
  const facts: Extract<Block, { kind: "expense" }>["facts"] = [];
  if (expense.allocations?.length) {
    const centres = [
      ...new Set(expense.allocations.map((a) => `${a.costCenter.code} - ${a.costCenter.name}`)),
    ];
    facts.push({ label: emailT("fact.costCenter"), value: centres.join(", ") });
  }
  if (expense.purchaseDate) {
    facts.push({ label: emailT("fact.purchaseDate"), value: isoDay(expense.purchaseDate) });
  }
  if (expense.paymentType) {
    facts.push({
      label: emailT("fact.payment"),
      value: paymentLabel(expense.paymentType),
      tag: expense.paymentType,
    });
  }

  return {
    kind: "expense",
    reference: expense.reference,
    title: expense.title,
    amount: formatOre(expense.grossAmount ?? 0),
    facts,
  };
}

type InvoiceKind = "assigned" | "returned" | "submitted";

const INVOICE_KINDS: Record<InvoiceKind, { tone: Tone; reason: "unitOwner" | "attester" }> = {
  assigned: { tone: "action", reason: "unitOwner" },
  returned: { tone: "warning", reason: "unitOwner" },
  submitted: { tone: "action", reason: "attester" },
};

export interface InvoiceFacts {
  id: string;
  reference: string | null;
  supplierName: string | null;
  invoiceNumber: string | null;
  description: string | null;
  amount: number | null; // öre
  dueDate: Date | null;
  allocations?: { costCenter: { code: string; name: string } }[];
}

/** What a levfaktura is called in a mail: what its unit said it was for. The supplier is the treasury's to settle at the kontering, so it is not named before then. */
const invoiceLabel = (i: InvoiceFacts): string => i.description || emailT("invoice.untitled");

/** The mail about one levfaktura, same shape as an utlägg's, with its LEV number. */
export function invoiceNotice(
  key: InvoiceKind,
  invoice: InvoiceFacts,
  values: Record<string, string | number> = {},
  comment?: { author: string; text: string | null },
): Email {
  const { tone, reason } = INVOICE_KINDS[key];
  const label = invoiceLabel(invoice);
  // Every one asks the reader to act: a unit goes straight to the fördelning, an attester to the record.
  const url = appUrl(
    key === "submitted" ? `/invoices/${invoice.id}` : `/invoices/${invoice.id}/allocate`,
  );

  const facts: Extract<Block, { kind: "expense" }>["facts"] = [];
  if (invoice.dueDate) {
    facts.push({ label: emailT("invoice.fact.dueDate"), value: isoDay(invoice.dueDate) });
  }
  if (invoice.allocations?.length) {
    const centres = [
      ...new Set(invoice.allocations.map((a) => `${a.costCenter.code} - ${a.costCenter.name}`)),
    ];
    facts.push({ label: emailT("fact.costCenter"), value: centres.join(", ") });
  }

  return {
    subject: emailT(`invoice.${key}.subject`, { label }),
    tone,
    eyebrow: emailT(`invoice.${key}.eyebrow`),
    heading: emailT(`invoice.${key}.heading`, values),
    intro: emailT(`invoice.${key}.intro`, values),
    blocks: [
      ...commentBlock(comment),
      {
        kind: "expense",
        reference: invoice.reference,
        title: label,
        amount: invoice.amount == null ? "-" : formatOre(invoice.amount),
        facts,
      },
    ],
    action: { label: emailT(`invoice.${key}.button`), url },
    orOpen: emailT("orOpen", { url }),
    ...frame(emailT(`invoice.reason.${reason}`)),
  };
}

/** The mail to a unit given a document from the Inkorg. Not an invoice yet, so no number or amount; the button goes to the fördelning. */
export function documentNotice(
  doc: { id: string; title: string | null; dueDate?: Date | null },
  values: Record<string, string | number> = {},
  comment?: { author: string; text: string | null },
): Email {
  const url = appUrl(`/invoices/inbox/${doc.id}`);
  const label = doc.title || emailT("invoice.untitled");
  return {
    subject: emailT("invoice.assigned.subject", { label }),
    tone: INVOICE_KINDS.assigned.tone,
    eyebrow: emailT("invoice.assigned.eyebrow"),
    heading: emailT("invoice.assigned.heading", values),
    intro: emailT("invoice.assigned.intro", values),
    blocks: [
      ...commentBlock(comment),
      {
        kind: "expense",
        reference: null,
        title: label,
        amount: "-",
        facts: doc.dueDate
          ? [{ label: emailT("invoice.fact.dueDate"), value: isoDay(doc.dueDate) }]
          : [],
      },
    ],
    action: { label: emailT("invoice.assigned.button"), url },
    orOpen: emailT("orOpen", { url }),
    ...frame(emailT(`invoice.reason.${INVOICE_KINDS.assigned.reason}`)),
  };
}

function commentBlock(comment?: { author: string; text: string | null }): Block[] {
  if (!comment?.text) return [];
  return [
    {
      kind: "comment",
      author: comment.author,
      when: stockholmMinute.format(new Date()),
      text: comment.text,
    },
  ];
}

/** Where an utlägg in a reminder stands from the reader's side: waiting for their attest, sent back, or never sent in. */
export type ReminderState = "attest" | "changes" | "draft";

export interface ReminderItem {
  expense: ExpenseFacts;
  state: ReminderState;
  submitter: string;
}

/** A hand-sent reminder about everything waiting on this reader, as one mail however much was picked. About a single utlägg it reads like that utlägg's own mail; otherwise it is sections like the digest. */
export function reminderEmail(
  sender: string,
  message: string | null,
  items: readonly ReminderItem[],
  txns: readonly Txn[] = [],
): Email {
  const note = commentBlock({ author: sender, text: message });
  const base = {
    tone: "action" as const,
    eyebrow: emailT("reminder.eyebrow"),
    ...frame(emailT("reason.reminder", { sender })),
  };

  if (items.length === 1 && txns.length === 0) {
    const { expense, state } = items[0];
    const url = appUrl(`/expenses/${expense.id}`);
    return {
      ...base,
      subject: emailT("reminder.subject", { label: mailLabel(expense) }),
      heading: emailT(`reminder.${state}.heading`, { sender }),
      intro: emailT(`reminder.${state}.intro`),
      blocks: [...note, expenseBlock(expense)],
      action: { label: emailT(`reminder.${state}.button`), url },
      orOpen: emailT("orOpen", { url }),
    };
  }

  const row = ({ expense, state, submitter }: ReminderItem): ListRow => ({
    title: mailLabel(expense),
    sub:
      state === "attest"
        ? emailT("reminder.fromSubmitter", { submitter })
        : emailT(`reminder.${state}.short`),
    amount: formatOre(expense.grossAmount ?? 0),
  });
  const attest = items.filter((i) => i.state === "attest");
  const own = items.filter((i) => i.state !== "attest");
  const sections: Block[] = [];
  if (attest.length) {
    sections.push({
      kind: "section",
      title: emailT("digest.attest"),
      blocks: [capped(attest.map(row))],
      button: { label: emailT("digest.attestButton"), url: appUrl("/expenses?scope=unit") },
    });
  }
  if (own.length) {
    sections.push({
      kind: "section",
      title: emailT("reminder.ownTitle"),
      blocks: [capped(own.map(row))],
      link: { label: emailT("digest.deadlineLink"), url: appUrl("/expenses") },
    });
  }
  if (txns.length) {
    sections.push({
      kind: "section",
      title: emailT("digest.unmatched"),
      hint: emailT("digest.unmatchedHint"),
      blocks: [transactionsBlock(txns, MAX_LINES)],
      link: { label: emailT("digest.unmatchedLink"), url: appUrl("/bank?scope=mine") },
    });
  }

  const count = items.length + txns.length;
  const kind = txns.length === 0 ? "expenses" : items.length === 0 ? "transactions" : "mixed";
  return {
    ...base,
    subject: emailT(`reminder.subjectMany.${kind}`, { count }),
    heading: emailT(`reminder.headingMany.${kind}`, { sender, count }),
    intro: emailT("reminder.introMany"),
    blocks: [...note, ...sections],
  };
}

/** Bank rows as a table, oldest first, refunds marked. Past `max` rows the rest is one line saying how many more. */
export function transactionsBlock(
  txns: readonly { transactionDate: Date; description: string; amount: number }[],
  max: number,
): Block {
  const sorted = [...txns].sort(
    (a, b) => a.transactionDate.getTime() - b.transactionDate.getTime(),
  );
  return {
    kind: "transactions",
    head: {
      date: emailT("column.date"),
      description: emailT("column.description"),
      amount: emailT("column.amount"),
    },
    refundLabel: emailT("refund"),
    rows: sorted.slice(0, max).map((t) => ({
      date: isoDay(t.transactionDate),
      description: t.description,
      amount: formatSignedOre(t.amount),
      refund: t.amount > 0,
    })),
    more: sorted.length > max ? emailT("more", { count: sorted.length - max }) : undefined,
  };
}

const MAX_LINES = 15;

export type Txn = { transactionDate: Date; description: string; amount: number };
export type ListRow = Extract<Block, { kind: "list" }>["rows"][number];

export type Waiting = { unmatched?: Txn[]; deadline?: ListRow[]; attest?: ListRow[] };

function capped(rows: ListRow[]): Extract<Block, { kind: "list" }> {
  return {
    kind: "list",
    rows: rows.slice(0, MAX_LINES),
    more: rows.length > MAX_LINES ? emailT("more", { count: rows.length - MAX_LINES }) : undefined,
  };
}

export function digestEmail(name: string, week: string, w: Waiting): Email {
  const unmatched = w.unmatched ?? [];
  const deadline = w.deadline ?? [];
  const attest = w.attest ?? [];
  const count = unmatched.length + deadline.length + attest.length;

  const stats: Extract<Block, { kind: "stats" }>["items"] = [];
  const sections: Block[] = [];
  if (unmatched.length) {
    stats.push({
      value: unmatched.length,
      label: emailT("digest.stat.unmatched"),
      tone: "neutral",
    });
    sections.push({
      kind: "section",
      title: emailT("digest.unmatched"),
      hint: emailT("digest.unmatchedHint"),
      blocks: [transactionsBlock(unmatched, MAX_LINES)],
      link: { label: emailT("digest.unmatchedLink"), url: appUrl("/bank?scope=mine") },
    });
  }
  if (deadline.length) {
    stats.push({
      value: deadline.length,
      label: emailT("digest.stat.deadline"),
      tone: "warning",
    });
    sections.push({
      kind: "section",
      title: emailT("digest.deadline"),
      hint: emailT("digest.deadlineHint", { days: REIMBURSEMENT_DEADLINE_DAYS }),
      blocks: [capped(deadline)],
      link: { label: emailT("digest.deadlineLink"), url: appUrl("/expenses") },
    });
  }
  if (attest.length) {
    stats.push({ value: attest.length, label: emailT("digest.stat.attest"), tone: "action" });
    sections.push({
      kind: "section",
      title: emailT("digest.attest"),
      hint: emailT("digest.attestHint"),
      blocks: [capped(attest)],
      button: { label: emailT("digest.attestButton"), url: appUrl("/expenses?scope=unit") },
    });
  }

  return {
    subject: emailT("digest.subject", { count }),
    tone: "action",
    eyebrow: emailT("digest.eyebrow", { week: Number(week.split("-W")[1]) }),
    heading: emailT("digest.heading", { name: name.split(" ")[0] || name }),
    blocks: [{ kind: "stats", items: stats }, ...sections],
    ...frame(emailT("reason.digest"), "settingsDigest"),
  };
}
