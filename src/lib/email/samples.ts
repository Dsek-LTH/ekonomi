// One made-up mail of every kind for the React Email preview server (emails/). Only the data is made up.
import {
  appUrl,
  digestEmail,
  emailT,
  expenseNotice,
  frame,
  invoiceNotice,
  reminderEmail,
  transactionsBlock,
} from "./content";
import type { Email } from "./types";
import type { NotificationKind } from "@/lib/domain/types";

const SAMPLE_EXPENSE = {
  id: "preview",
  reference: "DEK26-0043",
  title: "Kolsyra till pubben",
  grossAmount: 45000,
  purchaseDate: new Date("2026-10-08"),
  paymentType: "REIMBURSEMENT" as const,
  allocations: [{ costCenter: { code: "SEX01", name: "Sexmästeriet" } }],
};

const SAMPLE_INVOICE = {
  id: "preview",
  reference: "LEV26-0012",
  supplierName: "Lunds Släpvagnsuthyrning AB",
  invoiceNumber: "20417",
  description: "Släp till nollningen",
  amount: 125000,
  dueDate: new Date("2026-11-10"),
  allocations: [{ costCenter: { code: "SEX01", name: "Sexmästeriet" } }],
};

const SAMPLE_TRANSACTIONS = [
  {
    transactionDate: new Date("2026-10-02"),
    description: "ICA KVANTUM MALMBORGS",
    amount: -11790,
  },
  { transactionDate: new Date("2026-10-03"), description: "CLAS OHLSON 0421", amount: -43200 },
  { transactionDate: new Date("2026-10-06"), description: "Q*nelly.com", amount: 114400 },
  { transactionDate: new Date("2026-10-07"), description: "DOLLARSTORE LUND", amount: -4000 },
];

const EXPENSE: Partial<
  Record<NotificationKind, { key: Parameters<typeof expenseNotice>[0]; comment?: string }>
> = {
  EXPENSE_SUBMITTED: { key: "submitted" },
  EXPENSE_CHANGES_REQUESTED: {
    key: "changesRequested",
    comment: "Kvittot visar 405 kr, inte 450 kr. Kan du rätta beloppet?",
  },
  EXPENSE_DEADLINE_WAIVER_REVOKED: { key: "waiverRevoked" },
  EXPENSE_COST_CENTER_APPROVED: { key: "costCenterApproved" },
  EXPENSE_APPROVED: { key: "approved" },
  EXPENSE_READY_TO_BOOK: { key: "readyToBook" },
  EXPENSE_ATTEST_WITHDRAWN: {
    key: "attestWithdrawn",
    comment: "Fel kostnadsställe, jag attesterar igen när det är rättat.",
  },
  EXPENSE_RECALLED: { key: "recalled" },
  EXPENSE_EXPORTED: { key: "exported" },
  EXPENSE_EXPORT_REVERTED: {
    key: "exportReverted",
    comment: "Fel verifikationsserie, exporteras om.",
  },
  EXPENSE_DEADLINE_WAIVED: {
    key: "waived",
    comment: "Tåget var försenat, så kvittot kom in sent.",
  },
};

export function sampleEmail(kind: NotificationKind, name = "Maja Holm"): Email {
  const expense = EXPENSE[kind];
  if (expense) {
    return expenseNotice(
      expense.key,
      SAMPLE_EXPENSE,
      {
        actor: "Maja Holm",
        submitter: "Ludwig Gehlsdorf",
        costCenter: "SEX01 - Sexmästeriet",
        days: 60,
      },
      expense.comment ? { author: "Maja Holm", text: expense.comment } : undefined,
    );
  }

  if (kind === "CARD_TRANSACTIONS_IMPORTED") {
    const cards = emailT("cardMask", { last4: "4821" });
    const count = SAMPLE_TRANSACTIONS.length;
    const url = appUrl("/bank?scope=mine");
    return {
      subject: emailT("cardTransactions.subject", { count }),
      tone: "card",
      eyebrow: emailT("cardTransactions.eyebrow", { cards }),
      heading: emailT("cardTransactions.heading", { count }),
      intro: emailT("cardTransactions.intro"),
      blocks: [transactionsBlock(SAMPLE_TRANSACTIONS, 30)],
      action: { label: emailT("cardTransactions.button"), url },
      orOpen: emailT("orOpen", { url }),
      ...frame(emailT("reason.cardHolder", { cards })),
    };
  }

  if (kind === "SUPPLIER_INVOICE_ASSIGNED" || kind === "SUPPLIER_INVOICE_SUBMITTED") {
    return invoiceNotice(
      kind === "SUPPLIER_INVOICE_ASSIGNED" ? "assigned" : "submitted",
      SAMPLE_INVOICE,
      { actor: "Maja Holm", unit: "Sexmästeriet" },
    );
  }

  if (kind === "EXPENSE_REMINDER") {
    // Several at once, utlägg and card purchases: the shape of a reminder from the lists.
    const decor = {
      ...SAMPLE_EXPENSE,
      id: "preview-2",
      reference: "DEK26-0047",
      title: "Dekor till sittningen",
      grossAmount: 98000,
    };
    const tickets = {
      ...SAMPLE_EXPENSE,
      id: "preview-3",
      reference: null,
      title: "Tågbiljetter till SM-veckan",
      grossAmount: 64000,
    };
    return reminderEmail(
      "Ludwig Gehlsdorf",
      "Kan ni titta på de här innan styrelsemötet på torsdag?",
      [
        { expense: SAMPLE_EXPENSE, state: "attest", submitter: "Elsa Lindqvist" },
        { expense: decor, state: "attest", submitter: "Erik Ström" },
        { expense: tickets, state: "draft", submitter: name },
      ],
      SAMPLE_TRANSACTIONS.slice(0, 2),
    );
  }

  return digestEmail(name, "2026-W41", {
    unmatched: SAMPLE_TRANSACTIONS.slice(1, 3),
    deadline: [
      {
        title: "Tågbiljetter till SM-veckan",
        sub: "Utkast, köpt 2026-08-17",
        pill: "6 dagar kvar",
      },
    ],
    attest: [
      {
        title: "DEK26-0043 - Kolsyra till pubben",
        sub: "Från Ludwig Gehlsdorf, väntat i 5 dagar",
        amount: "450,00 kr",
      },
      {
        title: "DEK26-0047 - Dekor till sittningen",
        sub: "Från Elsa Lindqvist, väntat i 2 dagar",
        amount: "980,00 kr",
      },
    ],
  });
}
