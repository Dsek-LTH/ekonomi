// Domain types shared across the app. These mirror the Prisma models closely
// enough that server and client can reuse the same shapes.

// Section role. A user may hold several; access/attest authority is derived
// from the whole set in lib/domain/permissions.ts.
export type Role =
  | "SKATTMASTARE"
  | "ORDFORANDE"
  | "VICE_SKATTMASTARE"
  | "SKATTFORMAN"
  | "RESULTATANSVARIG"
  | "ORDINARIE";

export type PaymentType = "CARD" | "REIMBURSEMENT";

export type ExpenseStatus =
  | "DRAFT"
  | "PENDING_MATCH"
  | "PENDING_APPROVAL"
  | "CHANGES_REQUESTED"
  | "APPROVED"
  | "BOOKED"
  | "EXPORTED";

export interface User {
  id: string;
  name: string;
  email: string;
  roles: Role[];
  initials: string;
}

// The signed-in user, plus the capabilities that aren't stored on the User
// record itself. Only ever describes the acting user — everyone else is a plain
// `User`, where card holdership is neither known nor relevant (the admin page
// reads it off `Card.holderId` instead).
export interface CurrentUser extends User {
  holdsCard: boolean;
}

/** FORTNOX rows mirror the Fortnox chart; LOCAL ones exist only in this app. */
export type CostCenterSource = "FORTNOX" | "LOCAL";

export interface CostCenter {
  id: string;
  code: string;
  name: string;
  resultUnit?: string;
  active: boolean;
  source: CostCenterSource;
}

// A cost centre as listed under a result unit (or under "no result unit").
export interface ResultUnitCostCenter {
  code: string;
  name: string;
  active: boolean;
}

// A result unit (the grouping label on cost centres) and its resultatansvariga —
// the users who may attest/handle its expenses.
export interface ResultUnit {
  id: string;
  resultUnit: string; // the name
  // Cost-centre code prefixes that decide membership, e.g. "SKT" → SKT01, SKT02.
  prefixes: { id: string; value: string }[];
  owners: { id: string; name: string }[];
  // The cost centres the prefixes currently match, resolved live.
  costCenters: ResultUnitCostCenter[];
  costCenterCount: number; // active ones only
}

export interface CostAllocation {
  id: string;
  costCenterId: string;
  costCenterCode: string;
  costCenterName: string;
  resultUnit?: string; // resultatenhet the cost centre belongs to — drives attest authority
  amount: number; // SEK
  comment?: string;
  approvedById?: string;
  approvedByName?: string;
  approvedAt?: string; // ISO
  canAttest?: boolean; // whether the requesting viewer may attest this row
}

export interface RevisionEntry {
  id: string;
  actor: string;
  action: string; // ExpenseEventType — named by `expenses.event.<TYPE>`
  comment?: string;
  date: string; // ISO
}

export interface VerificationLine {
  id: string;
  account: string; // BAS account number
  accountName: string;
  description?: string;
  costCenterCode?: string;
  debit: number; // SEK
  credit: number; // SEK
}

export interface Verification {
  date: string; // ISO
  description: string;
  createdBy?: string;
  lines: VerificationLine[];
  fortnoxLabel?: string; // e.g. "A-42" once exported to Fortnox
  exportedAt?: string; // ISO
}

// One account in the BAS chart, mirrored from Fortnox.
export interface AccountRecord {
  number: string;
  name: string;
  active: boolean;
  sru?: string;
  lastSyncAt?: string; // ISO
}

// The accounts the booking view pre-fills — configurable, previously the
// ACCOUNT.* constants in lib/accounts.ts.
export interface BookkeepingSettings {
  bankAccount: string;
  memberDebtAccount: string;
}

// Status of the org's single Fortnox OAuth connection (no secrets exposed).
export interface FortnoxStatus {
  configured: boolean; // server has client id/secret/redirect configured
  connected: boolean; // the org's service connection is stored (reads + sync)
  companyName?: string;
  voucherSeries?: string;
  expiresAt?: string; // ISO — access-token expiry

  // The viewer's own Fortnox login, used when they book (writes). Separate from
  // the service connection above and short-lived by design.
  session?: {
    fortnoxUserName?: string;
    expiresAt: string; // ISO — when they must log in to Fortnox again
  };
}

export interface Expense {
  id: string; // the row's own id — what pages and API routes are keyed on
  // The human reference, e.g. "DEK26-0042". Absent until the utlägg is submitted
  // for attest; see lib/domain/reference.ts.
  reference?: string;
  title: string;
  submitterId: string;
  submitterName: string;
  allocations: CostAllocation[];
  paymentType: PaymentType;
  status: ExpenseStatus;
  purchaseDate: string; // ISO
  grossAmount: number; // SEK — the database stores öre; see lib/domain/money.ts
  currency: string;
  matchedTransactionId?: string;
  receiptId?: string; // newest uploaded receipt, if any
  receiptMimeType?: string; // its stored type (image/jpeg or application/pdf)
  submitterHasPayout: boolean; // submitter has clearing + account number on file
  verification?: Verification; // present once booked
  revisions: RevisionEntry[];
  canReturn?: boolean; // viewer may pull this back from APPROVED (bookkeeping)
}

export interface BankTransaction {
  id: string;
  transactionDate: string; // ISO — the day of the purchase (Transdag)
  description: string;
  amount: number; // negative = money out
  matchedExpenseId?: string; // the utlägg's id, for linking to it
  matchedExpenseRef?: string; // its human reference, once it has one
  // Section card that made the purchase, if known (from the CSV card number).
  cardLast4?: string;
  cardHolderId?: string;
  cardHolderName?: string;
}

export interface Card {
  id: string;
  last4: string;
  holderId?: string;
  holderName?: string;
  active: boolean;
  txCount: number; // linked bank transactions — surfaced before deletion
}
