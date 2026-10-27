// What each email says: the words, the facts, and the shape they are put in.
//
// The content half of the email feature, kept apart from the half that sends.
// Nothing here reads the database, sends anything or needs a request, so the
// same functions serve lib/server/notify.ts, which writes their output to the
// outbox, and the React Email preview server (emails/), which draws them with
// sample data. Everything returns an `Email` (types.ts) for render.tsx to draw.
import { createTranslator } from "next-intl";
import { oreToSEK } from "@/lib/domain/money";
import { REIMBURSEMENT_DEADLINE_DAYS } from "@/lib/domain/status";
import type { ExpenseStatus, PaymentType } from "@/lib/domain/types";
import type { Block, Email, Tone } from "./types";
import svEmail from "../../../messages/sv/email.json";
import svCommon from "../../../messages/sv/common.json";

/**
 * The address links in a mail point at. A mail is read outside the app, so
 * every link in it has to be absolute.
 */
export function appUrl(path = "/"): string {
  const base = process.env.APP_URL || "http://localhost:3000";
  return new URL(path, base).toString();
}

// ── Words ─────────────────────────────────────────────────────────
//
// Swedish, the section's language and the app's default. A member's language
// lives in a cookie in their browser, where a mail sent from a cron job cannot
// read it. messages/en/email.json is kept in step all the same, so storing a
// language on User is the only thing needed to send in English.
export const emailT = createTranslator({
  locale: "sv",
  messages: { email: svEmail },
  namespace: "email",
});

// Payment types and statuses are worded the way the app words them.
const commonT = createTranslator({ locale: "sv", messages: { common: svCommon }, namespace: "common" });
export const paymentLabel = (p: PaymentType): string => commonT(`payment.${p}.label`);
export const statusLabel = (s: ExpenseStatus): string => commonT(`status.${s}`);

const sek = new Intl.NumberFormat("sv-SE", { style: "currency", currency: "SEK" });
const signedSek = new Intl.NumberFormat("sv-SE", {
  style: "currency",
  currency: "SEK",
  signDisplay: "exceptZero",
});

/** An amount in öre, the way a mail shows it. */
export const formatOre = (ore: number): string => sek.format(oreToSEK(ore));

/** A bank amount, signed both ways, so a refund reads as money coming back. */
export const formatSignedOre = (ore: number): string => signedSek.format(oreToSEK(ore));

/** A calendar day as the app writes it. */
export const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

const stockholmMinute = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Stockholm",
  dateStyle: "short",
  timeStyle: "short",
});

/** What an utlägg is called in a mail: its reference and title, or only the
 *  title for a draft that has not been given a number yet. */
export const mailLabel = (e: { reference: string | null; title: string }): string =>
  e.reference ? `${e.reference} - ${e.title}` : e.title;

/** Why the reader got this mail, and the way out of getting more of them. */
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

// The colour of each mail, and who it is written to. Amber is for the mails
// that say something went backwards and the reader has something to fix or
// check; everything else carries the brand pink.
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

/** What a mail about an utlägg can say about it. Only id, reference, title and
 *  amount are needed; every other fact is shown when the caller has it. */
export interface ExpenseFacts {
  id: string;
  reference: string | null;
  title: string;
  grossAmount: number | null;
  purchaseDate?: Date | null;
  paymentType?: PaymentType;
  allocations?: { costCenter: { code: string; name: string } }[];
}

/**
 * The mail about one utlägg: what happened, which utlägg, and the button that
 * takes the reader to it. A comment, when the actor left one, is quoted above
 * the utlägg, since it is usually the reason the mail was sent.
 */
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

/** One utlägg as a mail shows it: reference, title, amount, and the facts the
 *  caller had to hand. */
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

/** What somebody wrote when they acted, quoted as of now. Nothing without text. */
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

// ── Reminders ─────────────────────────────────────────────────────

/**
 * Where an utlägg in a reminder stands, from the reader's side: waiting for
 * their attest, sent back to them, or never sent in.
 */
export type ReminderState = "attest" | "changes" | "draft";

export interface ReminderItem {
  expense: ExpenseFacts;
  state: ReminderState;
  /** Who sent it in, for the line under an utlägg waiting on the reader's attest. */
  submitter: string;
}

/**
 * A reminder somebody sent by hand, about everything in it that is waiting on
 * this reader: utlägg, and purchases on their card with no utlägg yet. One mail
 * per reader however much was picked: a resultatansvarig with eight unsigned
 * claims gets one mail listing eight, not eight mails.
 *
 * About a single utlägg it reads like the mail that utlägg would have sent,
 * with its facts and a button straight to it. Otherwise it is sections, like
 * the digest: the utlägg to attest, the reader's own, and the card purchases.
 */
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
      button: { label: emailT("digest.attestButton"), url: appUrl("/approvals") },
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

  // Worded by what is in it: utlägg alone, card purchases alone, or both.
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

/**
 * Bank rows as a table, oldest first, refunds marked. Past `max` rows the
 * rest is one line saying how many more; the link under the table leads to
 * all of them.
 */
export function transactionsBlock(
  txns: readonly { transactionDate: Date; description: string; amount: number }[],
  max: number,
): Block {
  const sorted = [...txns].sort((a, b) => a.transactionDate.getTime() - b.transactionDate.getTime());
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

// ── The weekly digest ─────────────────────────────────────────────

// Per section. The link under it leads to the whole list.
const MAX_LINES = 15;

export type Txn = { transactionDate: Date; description: string; amount: number };
export type ListRow = Extract<Block, { kind: "list" }>["rows"][number];

/** What one member has waiting, by section. A section left undefined is empty. */
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
    stats.push({ value: unmatched.length, label: emailT("digest.stat.unmatched"), tone: "neutral" });
    sections.push({
      kind: "section",
      title: emailT("digest.unmatched"),
      hint: emailT("digest.unmatchedHint"),
      blocks: [transactionsBlock(unmatched, MAX_LINES)],
      link: { label: emailT("digest.unmatchedLink"), url: appUrl("/bank?scope=mine") },
    });
  }
  if (deadline.length) {
    stats.push({ value: deadline.length, label: emailT("digest.stat.deadline"), tone: "warning" });
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
      button: { label: emailT("digest.attestButton"), url: appUrl("/approvals") },
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
