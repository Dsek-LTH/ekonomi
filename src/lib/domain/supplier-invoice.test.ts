import { describe, expect, it } from "vitest";
import {
  invoiceCapabilities,
  invoiceWaitsOn,
  submitBlocker,
  type InvoiceFacts,
  type InvoiceViewer,
} from "./supplier-invoice";
import type { Capability, Role } from "./types";

const viewer = (
  capabilities: Capability[] = [],
  ownedResultUnitIds: string[] = [],
  roles: Role[] = ownedResultUnitIds.length ? ["RESULTATANSVARIG"] : ["ORDINARIE"],
): InvoiceViewer => ({ id: "v", roles, capabilities, ownedResultUnitIds });

const triage = viewer(["INVOICE_TRIAGE"]);
const sexm = viewer(["ATTEST_VIEW"], ["unit-sex"]);
const other = viewer(["ATTEST_VIEW"], ["unit-cafe"]);
const bookkeeper = viewer(["BOOKKEEPING"]);

const invoice = (over: Partial<InvoiceFacts> = {}): InvoiceFacts => ({
  status: "ASSIGNED",
  resultUnitId: "unit-sex",
  allocations: [],
  ...over,
});

describe("submitBlocker", () => {
  const ready = {
    supplierName: "Lunds Släp AB",
    dueDate: "2026-11-10",
    amount: 125000,
    documentCount: 1,
    allocations: [{ amount: 125000, account: "5615" }],
  };

  it("lets a complete invoice through", () => {
    expect(submitBlocker(ready)).toBeNull();
  });

  it("asks for the PDF before anything else", () => {
    expect(submitBlocker({ ...ready, documentCount: 0, supplierName: null })).toBe(
      "supplierInvoice.noDocument",
    );
  });

  it.each([
    [{ supplierName: "  " }, "supplierInvoice.noSupplier"],
    [{ amount: null }, "supplierInvoice.noAmount"],
    [{ amount: 0 }, "supplierInvoice.noAmount"],
    [{ dueDate: null }, "supplierInvoice.noDueDate"],
    [{ allocations: [] }, "supplierInvoice.noAllocations"],
    [{ allocations: [{ amount: 125000, account: "" }] }, "supplierInvoice.allocationNoAccount"],
    [
      { allocations: [{ amount: 125000, account: "5615" }, { amount: 0, account: "5615" }] },
      "supplierInvoice.allocationNotPositive",
    ],
    [{ allocations: [{ amount: 120000, account: "5615" }] }, "supplierInvoice.allocationSumMismatch"],
  ])("refuses %o", (change, code) => {
    expect(submitBlocker({ ...ready, ...change })).toBe(code);
  });

  it("accepts a split that adds up to the öre", () => {
    expect(
      submitBlocker({
        ...ready,
        allocations: [
          { amount: 100050, account: "5615" },
          { amount: 24950, account: "4010" },
        ],
      }),
    ).toBeNull();
  });
});

describe("invoiceCapabilities", () => {
  it("keeps the inkorg to triage", () => {
    const inbox = invoice({ status: "INBOX", resultUnitId: null });
    expect(invoiceCapabilities(triage, inbox)).toMatchObject({
      canEdit: true,
      canAssign: true,
      canDiscard: true,
      canSubmit: false,
    });
    expect(invoiceCapabilities(sexm, inbox).canEdit).toBe(false);
  });

  it("lets the unit's resultatansvarig kontera and send, and nobody else's", () => {
    expect(invoiceCapabilities(sexm, invoice())).toMatchObject({
      canEdit: true,
      canSubmit: true,
      canAssign: false,
      canDiscard: false,
    });
    expect(invoiceCapabilities(other, invoice())).toMatchObject({ canEdit: false, canSubmit: false });
  });

  it("freezes the kontering while it is out for attest", () => {
    const pending = invoice({ status: "PENDING_APPROVAL" });
    expect(invoiceCapabilities(sexm, pending)).toMatchObject({
      canEdit: false,
      canSubmit: false,
      canRecall: true,
      canAssign: false,
    });
  });

  it("offers the attest only on rows still waiting for this viewer", () => {
    const pending = invoice({
      status: "PENDING_APPROVAL",
      allocations: [
        { approved: true, viewerMayAttest: true },
        { approved: false, viewerMayAttest: false },
      ],
    });
    expect(invoiceCapabilities(sexm, pending)).toMatchObject({
      canApprove: false,
      canRequestChanges: true,
    });
    const mine = invoice({
      status: "PENDING_APPROVAL",
      allocations: [{ approved: false, viewerMayAttest: true }],
    });
    expect(invoiceCapabilities(sexm, mine).canApprove).toBe(true);
  });

  it("lets the treasury send back an attested invoice, and no one else", () => {
    const approved = invoice({
      status: "APPROVED",
      allocations: [{ approved: true, viewerMayAttest: true }],
    });
    expect(invoiceCapabilities(bookkeeper, approved).canRequestChanges).toBe(true);
    expect(invoiceCapabilities(sexm, approved).canRequestChanges).toBe(false);
  });

  it("restores a discarded invoice for triage only", () => {
    const gone = invoice({ status: "DISCARDED" });
    expect(invoiceCapabilities(triage, gone)).toMatchObject({ canRestore: true, canEdit: false });
    expect(invoiceCapabilities(sexm, gone).canRestore).toBe(false);
  });
});

describe("invoiceWaitsOn", () => {
  it("puts the inkorg on triage's list", () => {
    expect(invoiceWaitsOn(triage, invoice({ status: "INBOX", resultUnitId: null }))).toBe(true);
    expect(invoiceWaitsOn(sexm, invoice({ status: "INBOX", resultUnitId: null }))).toBe(false);
  });

  it("puts an assigned invoice on its unit's list, not triage's", () => {
    expect(invoiceWaitsOn(sexm, invoice())).toBe(true);
    expect(invoiceWaitsOn(triage, invoice())).toBe(false);
    expect(invoiceWaitsOn(sexm, invoice({ status: "CHANGES_REQUESTED" }))).toBe(true);
  });

  it("puts an invoice out for attest on whoever still has a row to sign", () => {
    const pending = invoice({
      status: "PENDING_APPROVAL",
      allocations: [{ approved: false, viewerMayAttest: true }],
    });
    expect(invoiceWaitsOn(other, pending)).toBe(true);
    const signed = invoice({
      status: "PENDING_APPROVAL",
      allocations: [{ approved: true, viewerMayAttest: true }],
    });
    expect(invoiceWaitsOn(other, signed)).toBe(false);
  });
});
