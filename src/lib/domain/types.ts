// Domain types shared by server and client. Enums alias the generated Prisma enums
// (lib/domain/boundary.test.ts admits that one import path).
import type * as Schema from "@/lib/generated/prisma/enums";

export type Role = Schema.Role;

// One thing a role may be allowed to do. Each value has one helper in lib/domain/permissions.ts.
export type Capability = Schema.Capability;

export type PaymentType = Schema.PaymentType;

export type ClosingCheck = Schema.ClosingCheck;

export type NotificationKind = Schema.NotificationKind;

// ── Avtal ─────────────────────────────────────────────────────────

export type ContractKind = Schema.ContractKind;
export type ContractStatus = "DRAFT" | "SIGNED";
export type ContractFileRole = Schema.ContractFileRole;

// ── Alkohollager ──────────────────────────────────────────────────

export type StockKind = Schema.StockKind;

export type DrinkCategory = Schema.DrinkCategory;

// CHECKOUT and RETURN are the pair a pub night makes. WASTE (spilled at the pub) moves no stock
// because it was already off the shelf; SPOILAGE takes it off the shelf like any removal.
export type StockEntryKind = Schema.StockEntryKind;

// Where a day's takings came from. ZETTLE_FEE is Zettle's own transaction
// fees, which are a cost rather than income and book the other way round.
export type IncomeSource = Schema.IncomeSource;

// A day not booked has no state: it stays a draft until the next fetch of its source clears
// the working set (see createDayBatch).
export type IncomeReportStatus = Schema.IncomeReportStatus;

export type ExpenseStatus = Schema.ExpenseStatus;

export type ExportClaimState = Schema.ExportClaimState;

export type SupplierInvoiceStatus = Schema.SupplierInvoiceStatus;
export type SupplierInvoiceSource = Schema.SupplierInvoiceSource;
export type SupplierInvoiceEventType = Schema.SupplierInvoiceEventType;

export interface User {
  id: string;
  name: string;
  email: string;
  roles: Role[];
  /** Resolved per request from RoleCapability (lib/server/capabilities.ts), never stored or in the session. `roles` stays for rules that turn on the role itself. */
  capabilities: Capability[];
  initials: string;
}

export interface CurrentUser extends User {
  holdsCard: boolean;
}

/** FORTNOX rows mirror the Fortnox chart; LOCAL ones exist only in this app. */
export type CostCenterSource = Schema.CostCenterSource;

export interface CostCenter {
  id: string;
  code: string;
  name: string;
  shortName: string | null;
  resultUnit?: string;
  active: boolean;
  source: CostCenterSource;
}

export interface ResultUnitCostCenter {
  code: string;
  name: string;
  active: boolean;
}

export interface ResultUnit {
  id: string;
  resultUnit: string; // the name
  // Cost-centre code prefixes that decide membership, e.g. "SKT" → SKT01, SKT02.
  prefixes: { id: string; value: string }[];
  // Read-only here: the group mapping is edited under Inställningar → Roller, membership lives in Authentik.
  ownerGroups: string[];
  owners: { id: string; name: string }[];
  costCenters: ResultUnitCostCenter[];
  costCenterCount: number; // active ones only
  /** Null for a unit that takes no income, and when the income module is off. */
  income: ResultUnitIncome | null;
}

export interface ResultUnitIncome {
  id: string;
  /** Derived from the name at creation and never edited: report keys are built from it. */
  key: string;
  description: string;
  defaultCostCenterId: string | null;
  defaultCostCenterCode: string | null;
  active: boolean;
  /** Product-name prefixes: "s1 - Öl" → account 3011, plus the prefix's own cost centre when not the default. */
  prefixes: {
    id: string;
    code: string;
    account: string;
    accountName: string;
    costCenterId: string | null;
  }[];
}

export interface CostAllocation {
  id: string;
  costCenterId: string;
  costCenterCode: string;
  costCenterName: string;
  resultUnit?: string; // resultatenhet the cost centre belongs to, drives attest authority
  amount: number; // SEK
  comment?: string;
  approvedById?: string;
  approvedByName?: string;
  approvedAt?: string; // ISO
  canAttest?: boolean; // whether the requesting viewer may attest this row
}

interface RevisionEntry {
  id: string;
  actor: string;
  /** Who, for their picture. Absent for the system's own events. */
  actorId?: string;
  action: string; // ExpenseEventType, named by `expenses.event.<TYPE>`
  comment?: string;
  /** Who a REMINDER_SENT went to, by name as they were then. */
  recipients?: string[];
  /** What a CORRECTED changed. See lib/domain/correction.ts. */
  correction?: import("./correction").CorrectionDiff;
  date: string; // ISO
}

export interface VerificationLine {
  id: string;
  account: string; // BAS account number
  accountName: string;
  description?: string;
  costCenterCode?: string;
  project?: string; // Fortnox project number
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

export interface AccountRecord {
  number: string;
  name: string;
  active: boolean;
  sru?: string;
  lastSyncAt?: string; // ISO
}

export interface ProjectRecord {
  number: string;
  name: string;
  active: boolean;
}

// Null is "not chosen yet".
export interface BookkeepingSettings {
  bankAccount: string | null;
  memberDebtAccount: string | null;
}

export interface FortnoxStatus {
  configured: boolean; // server has client id/secret/redirect configured
  connected: boolean; // the org's service connection is stored (reads + sync)
  companyName?: string;
  voucherSeries?: string;
  // Set when Fortnox refused to renew the connection. Nothing reads from Fortnox until it is reconnected.
  refreshFailed?: { at: string; error: string };

  // The viewer's own Fortnox login, used for writes. Separate from the service connection.
  session?: {
    fortnoxUserName?: string;
    expiresAt: string; // ISO, when they must log in to Fortnox again
  };
}

interface MileageJourney {
  /** Odometer readings in km. Null while not given (0 is a real reading). */
  odometerStart: number | null;
  odometerEnd: number | null;
  /** Every stop in order; a round trip repeats the first stop last. A sent claim names at least two. */
  stops: string[];
  km: number | null;
  /** What a km was worth on the day, in öre. */
  orePerKm: number | null;
}

export interface ReceiptSummary {
  id: string;
  filename: string;
  mimeType: string; // image/jpeg, image/png or application/pdf
}

export interface Expense {
  id: string; // the row's own id, what pages and API routes are keyed on
  // Absent until submitted for attest.
  reference?: string;
  title: string;
  submitterId: string;
  submitterName: string;
  submitterStudentId: string; // the StiL id, what a voucher text identifies them by
  allocations: CostAllocation[];
  paymentType: PaymentType;
  status: ExpenseStatus;
  purchaseDate: string; // ISO
  grossAmount: number; // SEK, the database stores öre, see lib/domain/money.ts
  currency: string;
  matchedTransactionId?: string;
  /** Oldest first: the order they are stapled behind the cover for Fortnox (lib/server/pdf-merge.ts). */
  receipts: ReceiptSummary[];
  /** The journey, for a MILEAGE utlägg only. grossAmount is computed server-side. */
  mileage?: MileageJourney;
  submitterHasPayout: boolean; // submitter has clearing + account number on file
  verification?: Verification; // present once booked
  revisions: RevisionEntry[];
  canReturn?: boolean; // viewer may pull this back from APPROVED (bookkeeping)
  /** Row version, ISO with ms; compared with the heartbeat's to detect a concurrent save. */
  updatedAt: string;
  /** The dispens that let this late utlägg past the filing deadline, if any. */
  deadlineWaiver?: DeadlineWaiver;
}

interface DeadlineWaiver {
  by: string; // the granter's name
  at: string; // ISO
  reason: string;
}

export interface BankTransaction {
  id: string;
  transactionDate: string; // ISO, the day of the purchase (Transdag)
  description: string;
  amount: number; // negative = money out
  matchedExpenseId?: string; // the utlägg's id, for linking to it
  matchedExpenseRef?: string; // its human reference, once it has one
  // Section card that made the purchase, if known (from the CSV card number,
  // or put there by hand for a row the export named no card on).
  cardId?: string;
  cardLast4?: string;
  cardHolderId?: string;
  cardHolderName?: string;
}

export interface Card {
  id: string;
  last4: string;
  holderId?: string;
  holderName?: string;
  resultUnitId?: string;
  resultUnitName?: string;
  active: boolean;
  txCount: number; // linked bank transactions, surfaced before deletion
}
