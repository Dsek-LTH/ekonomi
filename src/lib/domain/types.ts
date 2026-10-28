// Domain types shared across the app. These mirror the Prisma models closely
// enough that server and client can reuse the same shapes.
//
// The enums are *derived* from the schema rather than retyped from it. Fourteen
// of them were written out here by hand, which meant adding a value to
// schema.prisma and forgetting this file compiled fine and then failed at
// runtime on a string TypeScript had never heard of. Aliasing the generated
// ones makes that a compile error at every exhaustive switch instead.
//
// `generated/prisma/enums` is safe here despite the folder it is in: it has no
// imports of its own and no engine behind it, only the schema's enums as
// consts, which is why Prisma marks it importable on its own and why
// lib/domain/boundary.test.ts admits this one path. The doc comments below stay
// because the schema cannot carry what a value *means* to this section.
import type * as Schema from "@/lib/generated/prisma/enums";

// Section role. A user may hold several; access/attest authority is derived
// from the whole set in lib/domain/permissions.ts.
export type Role = Schema.Role;

// One thing a role may be allowed to do. Which roles hold which is a table
// (RoleCapability) edited in Inställningar → Roller; this list is not, because
// each value is a question some call site asks and one nobody asks would be a
// tickbox that does nothing. Every value has exactly one helper in
// lib/domain/permissions.ts. See the enum in prisma/schema/auth.prisma for what
// each one covers, and why the attest rule is not among them.
export type Capability = Schema.Capability;

export type PaymentType = Schema.PaymentType;

// Which of the app's own facts decides a bokslut checklist item. See the enum
// in prisma/schema/closing.prisma and lib/closing/checklist.ts.
export type ClosingCheck = Schema.ClosingCheck;

// What an email is about, and what a member switches on or off in their
// profile. Defaults and which ones can be switched: lib/domain/notifications.ts.
export type NotificationKind = Schema.NotificationKind;

// ── Avtal ─────────────────────────────────────────────────────────

// What kind of agreement a contract is, where it stands, what one of its files
// is to it, and which side a party signs for. See the enums in
// prisma/schema/contract.prisma, which carry what each value means.
export type ContractKind = Schema.ContractKind;
/** Where an agreement stands. Derived from its files rather than stored: see
 *  lib/contract/status.ts. */
export type ContractStatus = "DRAFT" | "SIGNED";
export type ContractFileRole = Schema.ContractFileRole;

// ── Alkohollager ──────────────────────────────────────────────────

// How a product's stock is counted: whole units (cans) or sealed bottles plus
// open ones at a fill level. See lib/stock/levels.ts.
export type StockKind = Schema.StockKind;

// The drink types the bar keeps its stock in. All five need a purchased volume
// on the restaurangrapport, so there is no "reported" subset any more.
export type DrinkCategory = Schema.DrinkCategory;

// Why stock moved. The report keeps these apart: bought is a volume, served is
// turnover, spilled is neither, so the log does too.
//
// CHECKOUT and RETURN are the pair a pub night makes: bottles leave the store
// and come back, and the return is the one moment anybody looks at a bottle and
// says what is left in it. See lib/stock/levels.ts.
//
// WASTE and SPOILAGE are both stock destroyed, and they are two kinds because
// they happened in two places. A spill at a pub was already off the shelf when
// it hit the floor, so WASTE moves no stock and its quantity sits in its own
// column. A bottle dropped in the cellar never left, so SPOILAGE takes it off
// the shelf like any other removal. See the enum in prisma/schema/stock.prisma.
export type StockEntryKind = Schema.StockEntryKind;

// Where a day's takings came from. ZETTLE_FEE is Zettle's own transaction
// fees, which are a cost rather than income and book the other way round.
export type IncomeSource = Schema.IncomeSource;

// A report's life: fetched, then booked, and finally pushed to Fortnox. A day
// you decide not to book has no state of its own. It stays a draft until the
// next fetch clears the working set (see createSalesBatch).
export type IncomeReportStatus = Schema.IncomeReportStatus;

export type ExpenseStatus = Schema.ExpenseStatus;

/** How far an export to Fortnox has got. See lib/domain/export-claim.ts. */
export type ExportClaimState = Schema.ExportClaimState;

// Leverantörsfakturor. What each status means is in
// prisma/schema/supplier-invoice.prisma, and the rules over them in
// lib/domain/supplier-invoice.ts.
export type SupplierInvoiceStatus = Schema.SupplierInvoiceStatus;
export type SupplierInvoiceSource = Schema.SupplierInvoiceSource;
export type SupplierInvoiceEventType = Schema.SupplierInvoiceEventType;

export interface User {
  id: string;
  name: string;
  email: string;
  roles: Role[];
  /**
   * What those roles are currently allowed to do, resolved per request from
   * the RoleCapability table (lib/server/capabilities.ts), never stored on the
   * row and never carried in the session.
   *
   * This is what every gate reads. `roles` is still here because a few rules
   * genuinely turn on which role you hold rather than on what it may do (the
   * attest rule's resultatansvarig clause) and because
   * the settings screens list people by role.
   */
  capabilities: Capability[];
  initials: string;
}

// The signed-in user, plus what isn't stored on the User record itself. Only
// ever describes the acting user. Everyone else is a plain `User`, where card
// holdership is neither known nor relevant (the admin page reads it off
// `Card.holderId` instead).
export interface CurrentUser extends User {
  holdsCard: boolean;
}

/** FORTNOX rows mirror the Fortnox chart; LOCAL ones exist only in this app. */
export type CostCenterSource = Schema.CostCenterSource;

export interface CostCenter {
  id: string;
  code: string;
  name: string;
  /** What it is called under its result unit's heading, when somebody has
   *  chosen one. See lib/domain/cost-center-short-name.ts. */
  shortName: string | null;
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

// A result unit (the grouping label on cost centres) and its resultatansvariga,
// the users who may attest/handle its expenses.
export interface ResultUnit {
  id: string;
  resultUnit: string; // the name
  // Cost-centre code prefixes that decide membership, e.g. "SKT" → SKT01, SKT02.
  prefixes: { id: string; value: string }[];
  // The Authentik groups that make someone resultatansvarig for this unit, and
  // who currently holds them. Both are read-only on the result-unit screen: the
  // mapping is edited under Inställningar → Roller and the membership lives in
  // Authentik.
  ownerGroups: string[];
  owners: { id: string; name: string }[];
  // The cost centres the prefixes currently match, resolved live.
  costCenters: ResultUnitCostCenter[];
  costCenterCount: number; // active ones only
  /**
   * The income half, for a unit that takes money in. Null for one that does
   * not, and null throughout when the income module is switched off, so nothing on
   * the result-unit screen depends on income existing.
   */
  income: ResultUnitIncome | null;
}

/** What a result unit needs in order to take money in. See ResultUnitIncome. */
export interface ResultUnitIncome {
  id: string;
  /**
   * What intakt groups the unit's reports by. Derived from the name when the
   * profile is created and never edited after: the name is prose someone may
   * reword, this is an identifier another program holds.
   */
  key: string;
  /** The verifikationstext a booked day carries. */
  description: string;
  defaultCostCenterId: string | null;
  defaultCostCenterCode: string | null;
  active: boolean;
  /** Product-name prefixes: "s1 - Öl" → account 3011. */
  prefixes: { id: string; code: string; account: string; accountName: string; isFallback: boolean }[];
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
  action: string; // ExpenseEventType, named by `expenses.event.<TYPE>`
  comment?: string;
  /** Who a REMINDER_SENT went to, by name as they were then. */
  recipients?: string[];
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

// One account in the BAS chart, mirrored from Fortnox.
export interface AccountRecord {
  number: string;
  name: string;
  active: boolean;
  sru?: string;
  lastSyncAt?: string; // ISO
}

// One Fortnox project, mirrored like the chart of accounts.
export interface ProjectRecord {
  number: string;
  name: string;
  active: boolean;
}

// The accounts the booking view pre-fills, configurable, previously the
// ACCOUNT.* constants in lib/accounts.ts.
// Null is "not chosen yet": nothing that needs the value works until it is.
export interface BookkeepingSettings {
  bankAccount: string | null;
  memberDebtAccount: string | null;
}

// Status of the org's single Fortnox OAuth connection (no secrets exposed).
export interface FortnoxStatus {
  configured: boolean; // server has client id/secret/redirect configured
  connected: boolean; // the org's service connection is stored (reads + sync)
  companyName?: string;
  voucherSeries?: string;
  expiresAt?: string; // ISO, access-token expiry

  // The viewer's own Fortnox login, used when they book (writes). Separate from
  // the service connection above and short-lived by design.
  session?: {
    fortnoxUserName?: string;
    expiresAt: string; // ISO, when they must log in to Fortnox again
  };
}

/**
 * The journey a milersättning is, as the client reads it.
 *
 * The odometer at each end and what the distance between them came to. The
 * distance is carried rather than left to be subtracted again on every screen
 * that shows it. One rule, in lib/mileage/claim.ts, and everything downstream
 * reads its answer.
 */
interface MileageJourney {
  /** The odometer when the journey began and when it ended, in kilometres.
   *  Null for a reading not given yet. A draft may hold one and not the
   *  other, and 0 is a real reading. */
  odometerStart: number | null;
  odometerEnd: number | null;
  /** Every place the car stopped, in order. The first is where the journey
   *  began, the last where it ended, the rest what was visited on the way. A
   *  round trip repeats its first stop last. Empty on a draft nobody has filled
   *  in; a claim cannot be sent naming fewer than two places. */
  stops: string[];
  /** `odometerEnd - odometerStart`, or null while the two do not make a
   *  journey. */
  km: number | null;
  /** What a kilometre was worth on the day, in öre. Null on a claim that was
   *  never valued. */
  orePerKm: number | null;
}

/** One attached document, as far as anything outside lib/data/expenses.ts
 *  needs to know about it: enough to show it, name it and offer to remove it. */
export interface ReceiptSummary {
  id: string;
  filename: string;
  mimeType: string; // image/jpeg, image/png or application/pdf
}

export interface Expense {
  id: string; // the row's own id, what pages and API routes are keyed on
  // The human reference, e.g. "DEK26-0042". Absent until the utlägg is submitted
  // for attest; see lib/domain/reference.ts.
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
  /**
   * Every document attached, oldest first: the order they were uploaded in,
   * which is the order they are stapled behind the cover for Fortnox (see
   * lib/server/pdf-merge.ts). Empty rather than absent where there are none.
   */
  receipts: ReceiptSummary[];
  /**
   * The journey, for a MILEAGE utlägg. Absent for every other payment type,
   * which has none.
   *
   * `grossAmount` is what it comes to and `purchaseDate` is the day it was
   * driven; the amount is the server's, computed in lib/mileage/claim.ts. The
   * rate it was valued at rides the claim, so the utläggsräkning drawn from it
   * a year later still adds up to what was paid.
   */
  mileage?: MileageJourney;
  submitterHasPayout: boolean; // submitter has clearing + account number on file
  verification?: Verification; // present once booked
  revisions: RevisionEntry[];
  canReturn?: boolean; // viewer may pull this back from APPROVED (bookkeeping)
  /**
   * When the row last changed, ISO with milliseconds. The booking screen sends
   * it back as the version it was looking at, and compares it against the
   * heartbeat's to notice that somebody else saved in the meantime.
   */
  updatedAt: string;
  /**
   * The dispens that let this late utlägg past the filing deadline, if one was
   * given. Absent on every utlägg that never needed one, which is nearly all of
   * them.
   *
   * The claim is still late; this says the section decided to take it anyway.
   * See the dispens columns on Expense in the schema, and `isLateReimbursement`.
   */
  deadlineWaiver?: DeadlineWaiver;
}

/** Who allowed one late utlägg in, when, and why. */
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
  /** The result unit whose resultatansvarig may read this card's purchases. */
  resultUnitId?: string;
  resultUnitName?: string;
  active: boolean;
  txCount: number; // linked bank transactions, surfaced before deletion
}
