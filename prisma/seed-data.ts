// Seed fixtures for a fresh database. These were the frontend mock dataset
// (the UI now reads from the DB instead). The seed maps these into real rows;
// amounts are in plain SEK here and converted to öre on insert.
import type { BankTransaction, CostCenter, User } from "../src/lib/domain/types";

export interface SeedExpense {
  // The human reference. Null for an utlägg that hasn't been submitted for
  // attest yet — that is when the number is handed out, so a draft has none.
  reference: string | null;
  title: string;
  submitterName: string;
  allocations: { costCenterCode: string; amount: number }[]; // SEK, must sum to grossAmount
  paymentType: "CARD" | "REIMBURSEMENT";
  status: "DRAFT" | "PENDING_MATCH" | "PENDING_APPROVAL" | "CHANGES_REQUESTED" | "APPROVED" | "BOOKED" | "EXPORTED";
  purchaseDate: string;
  grossAmount: number;
  currency: string;
  matchedTransactionId?: string;
  revisions: { id: string; actor: string; action: string; comment?: string; date: string }[];
}

// The four people the dev sign-in offers, one per role. `studentId` is what
// the app keys a user on (Authentik's `preferred_username`), so these are
// fixed rather than generated — app/login/page.tsx names them, and a reseed
// must not move them. Everyone else referenced in the fixtures gets a derived
// one; see `studentIdFor` in seed.ts.
export const CURRENT_USERS: Record<string, User & { studentId: string }> = {
  ORDINARIE: {
    id: "u1",
    studentId: "el1234li-s",
    name: "Elsa Lindqvist",
    email: "elsa.lindqvist@user.dsek.se",
    roles: ["ORDINARIE"],
    initials: "EL",
  },
  RESULTATANSVARIG: {
    id: "u2",
    studentId: "os5678be-s",
    name: "Oskar Berg",
    email: "oskar.berg@user.dsek.se",
    roles: ["RESULTATANSVARIG"],
    initials: "OB",
  },
  SKATTFORMAN: {
    id: "u3",
    studentId: "lu9012ge-s",
    name: "Ludwig Gehlsdorf",
    email: "ludwig.gehlsdorf@user.dsek.se",
    roles: ["SKATTFORMAN"],
    initials: "LG",
  },
  SKATTMASTARE: {
    id: "u4",
    studentId: "ma3456ho-s",
    name: "Maja Holm",
    email: "maja.holm@user.dsek.se",
    roles: ["SKATTMASTARE"],
    initials: "MH",
  },
};

// `resultUnit` (resultatenhet) drives attest authority: whoever answers for the
// result unit attests that cost centre's allocations. `ownerName`, when set,
// seeds a resultatansvarig ownership for that result unit.
export const COST_CENTERS: (CostCenter & { ownerName?: string })[] = [
  { id: "c1", code: "NÄRU", name: "Näringslivsutskottet", resultUnit: "Näringslivsutskottet", ownerName: "Oskar Berg", active: true, source: "FORTNOX" },
  { id: "c2", code: "SEXM", name: "Sexmästeriet", resultUnit: "Sexmästeriet", ownerName: "Klara Ström", active: true, source: "FORTNOX" },
  { id: "c3", code: "STYR", name: "Styrelsen", resultUnit: "Styrelsen", active: true, source: "FORTNOX" },
  { id: "c4", code: "INFU", name: "Infoutskottet", resultUnit: "Infoutskottet", ownerName: "Oskar Berg", active: true, source: "FORTNOX" },
  { id: "c5", code: "IDRU", name: "Idrottsutskottet", resultUnit: "Idrottsutskottet", ownerName: "Klara Ström", active: true, source: "FORTNOX" },
];

export const EXPENSES: SeedExpense[] = [
  {
    reference: null,
    title: "Fika till sektionsmöte",
    submitterName: "Elsa Lindqvist",
    allocations: [{ costCenterCode: "NÄRU", amount: 845.5 }],
    paymentType: "REIMBURSEMENT",
    status: "DRAFT",
    purchaseDate: "2026-06-12",
    grossAmount: 845.5,
    currency: "SEK",
    revisions: [
      { id: "r1", actor: "Elsa Lindqvist", action: "Skapade utlägget", date: "2026-06-12T09:14:00" },
    ],
  },
  {
    reference: null,
    title: "Banderoll till mottagningen",
    submitterName: "Elsa Lindqvist",
    allocations: [{ costCenterCode: "INFU", amount: 1290 }],
    paymentType: "CARD",
    status: "PENDING_MATCH",
    purchaseDate: "2026-06-10",
    grossAmount: 1290,
    currency: "SEK",
    revisions: [
      { id: "r1", actor: "Elsa Lindqvist", action: "Skapade utlägget", date: "2026-06-10T16:02:00" },
      { id: "r2", actor: "Elsa Lindqvist", action: "Fyllde i kvittouppgifter", date: "2026-06-10T16:05:00" },
    ],
  },
  {
    reference: "DEK26-0039",
    title: "Pizza till arbetskväll",
    submitterName: "Anton Falk",
    // Multi-cost-centre example: shared between two result units.
    allocations: [
      { costCenterCode: "SEXM", amount: 1000 },
      { costCenterCode: "NÄRU", amount: 560 },
    ],
    paymentType: "CARD",
    status: "PENDING_APPROVAL",
    purchaseDate: "2026-06-08",
    grossAmount: 1560,
    currency: "SEK",
    matchedTransactionId: "t3",
    revisions: [
      { id: "r1", actor: "Anton Falk", action: "Skapade utlägget", date: "2026-06-08T20:11:00" },
      { id: "r2", actor: "Anton Falk", action: "Matchade mot banktransaktion", date: "2026-06-09T10:00:00" },
      { id: "r3", actor: "Anton Falk", action: "Skickade in för attest", date: "2026-06-09T10:01:00" },
    ],
  },
  {
    reference: "DEK26-0038",
    title: "Priser till idrottsdagen",
    submitterName: "Sara Nyberg",
    allocations: [{ costCenterCode: "IDRU", amount: 2340 }],
    paymentType: "REIMBURSEMENT",
    status: "CHANGES_REQUESTED",
    purchaseDate: "2026-06-05",
    grossAmount: 2340,
    currency: "SEK",
    revisions: [
      { id: "r1", actor: "Sara Nyberg", action: "Skapade utlägget", date: "2026-06-05T13:20:00" },
      { id: "r2", actor: "Sara Nyberg", action: "Skickade in för attest", date: "2026-06-06T09:00:00" },
      {
        id: "r3",
        actor: "Klara Ström",
        action: "Begärde ändring",
        comment: "Kvittot är otydligt – ladda upp en skarpare bild tack.",
        date: "2026-06-06T15:42:00",
      },
    ],
  },
  {
    reference: "DEK26-0036",
    title: "Kontorsmaterial",
    submitterName: "Elsa Lindqvist",
    allocations: [{ costCenterCode: "STYR", amount: 432 }],
    paymentType: "CARD",
    status: "APPROVED",
    purchaseDate: "2026-06-02",
    grossAmount: 432,
    currency: "SEK",
    matchedTransactionId: "t6",
    revisions: [
      { id: "r1", actor: "Elsa Lindqvist", action: "Skapade utlägget", date: "2026-06-02T11:00:00" },
      { id: "r2", actor: "Elsa Lindqvist", action: "Matchade mot banktransaktion", date: "2026-06-02T11:10:00" },
      { id: "r3", actor: "Elsa Lindqvist", action: "Skickade in för attest", date: "2026-06-02T11:11:00" },
      { id: "r4", actor: "Maja Holm", action: "Attesterade utlägget", date: "2026-06-03T08:30:00" },
    ],
  },
  {
    reference: "DEK26-0034",
    title: "Förtäring styrelsemöte",
    submitterName: "Anton Falk",
    allocations: [{ costCenterCode: "STYR", amount: 318 }],
    paymentType: "CARD",
    status: "BOOKED",
    purchaseDate: "2026-05-28",
    grossAmount: 318,
    currency: "SEK",
    matchedTransactionId: "t8",
    revisions: [
      { id: "r1", actor: "Anton Falk", action: "Skapade utlägget", date: "2026-05-28T09:00:00" },
      { id: "r2", actor: "Maja Holm", action: "Attesterade utlägget", date: "2026-05-29T08:30:00" },
      { id: "r3", actor: "Ludwig Gehlsdorf", action: "Bokförde utlägget", date: "2026-05-30T14:00:00" },
    ],
  },
  {
    reference: "DEK26-0031",
    title: "Trycksaker phadderverksamhet",
    submitterName: "Sara Nyberg",
    allocations: [{ costCenterCode: "INFU", amount: 4120 }],
    paymentType: "REIMBURSEMENT",
    status: "EXPORTED",
    purchaseDate: "2026-05-20",
    grossAmount: 4120,
    currency: "SEK",
    matchedTransactionId: "t10",
    revisions: [
      { id: "r1", actor: "Sara Nyberg", action: "Skapade utlägget", date: "2026-05-20T10:00:00" },
      { id: "r2", actor: "Oskar Berg", action: "Attesterade utlägget", date: "2026-05-21T08:30:00" },
      { id: "r3", actor: "Ludwig Gehlsdorf", action: "Bokförde utlägget", date: "2026-05-22T14:00:00" },
      { id: "r4", actor: "Ludwig Gehlsdorf", action: "Exporterade till Fortnox", date: "2026-05-22T14:05:00" },
    ],
  },
];

export const BANK_TRANSACTIONS: BankTransaction[] = [
  { id: "t1", transactionDate: "2026-06-11", description: "STORDBOOSTER AB", amount: -1290 },
  { id: "t2", transactionDate: "2026-06-11", description: "SWISH inbetalning", amount: 500 },
  { id: "t3", transactionDate: "2026-06-08", description: "PIZZERIA ROMA", amount: -1560, matchedExpenseId: "DEK26-0039" },
  { id: "t4", transactionDate: "2026-06-07", description: "WILLYS LUND", amount: -642 },
  { id: "t5", transactionDate: "2026-06-04", description: "SYSTEMBOLAGET", amount: -980 },
  { id: "t6", transactionDate: "2026-06-02", description: "CLAS OHLSON 0421", amount: -432, matchedExpenseId: "DEK26-0036" },
  { id: "t7", transactionDate: "2026-05-30", description: "BANKAVGIFT", amount: -75 },
  { id: "t8", transactionDate: "2026-05-28", description: "ESPRESSO HOUSE", amount: -318, matchedExpenseId: "DEK26-0034" },
  { id: "t9", transactionDate: "2026-05-25", description: "ÅTERBETALNING medlem", amount: -4120 },
  { id: "t10", transactionDate: "2026-05-22", description: "TRYCKERI LUND AB", amount: -4120, matchedExpenseId: "DEK26-0031" },
];

// Section cards ("sektionskort"). Only some members hold one. `transactionIds`
// are the mock bank-transaction ids this card paid for (tagged on the txn so
// the holder can see which card purchases still need a receipt).
export interface SeedCard {
  last4: string;
  holderName: string | null; // null = unassigned (admin to assign)
  transactionIds: string[];
}

export const CARDS: SeedCard[] = [
  {
    last4: "8842",
    holderName: "Elsa Lindqvist",
    transactionIds: ["t1", "t4", "t8"], // t8 is already matched → not "missing"
  },
  {
    last4: "3310",
    holderName: "Ludwig Gehlsdorf",
    transactionIds: ["t5"],
  },
  {
    last4: "9001",
    holderName: null, // unassigned — appears in admin to be assigned
    transactionIds: [],
  },
];
