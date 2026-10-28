import { describe, expect, it } from "vitest";
import {
  attestBlocker,
  daysUntilDue,
  exportBlocker,
  invoiceCapabilities,
  invoiceQueue,
  type InvoiceFacts,
  type InvoiceViewer,
} from "./supplier-invoice";
import type { Capability, Role } from "./types";

const viewer = (
  capabilities: Capability[] = [],
  ownedResultUnitIds: string[] = [],
  roles: Role[] = ownedResultUnitIds.length ? ["RESULTATANSVARIG"] : ["ORDINARIE"],
  id = "v",
): InvoiceViewer => ({ id, roles, capabilities, ownedResultUnitIds });

const triage = viewer(["INVOICE_TRIAGE"]);
const treasurer = viewer(["INVOICE_TRIAGE", "BOOKKEEPING"]);
const sexm = viewer(["ATTEST_VIEW"], ["unit-sex"]);
const cafe = viewer(["ATTEST_VIEW"], ["unit-cafe"]);
const revisor = viewer(["BOOKKEEPING_VIEW"]);

const invoice = (over: Partial<InvoiceFacts> = {}): InvoiceFacts => ({
  status: "ASSIGNED",
  resultUnitId: "unit-sex",
  allocations: [],
  ...over,
});

describe("attestBlocker", () => {
  it("lets one row through without an amount: it is the whole invoice", () => {
    expect(attestBlocker({ documentCount: 1, rows: [{ amount: null }], invoiceAmount: null })).toBeNull();
  });

  it("wants the PDF first", () => {
    expect(attestBlocker({ documentCount: 0, rows: [{ amount: null }], invoiceAmount: null })).toBe(
      "supplierInvoice.noDocument",
    );
  });

  it("wants a share on every row of a split", () => {
    expect(
      attestBlocker({ documentCount: 1, rows: [{ amount: 50000 }, { amount: null }], invoiceAmount: null }),
    ).toBe("supplierInvoice.splitNeedsAmounts");
  });

  it("holds a split to the total when the total is known", () => {
    const rows = [{ amount: 50000 }, { amount: 40000 }];
    expect(attestBlocker({ documentCount: 1, rows, invoiceAmount: 100000 })).toBe(
      "supplierInvoice.allocationSumMismatch",
    );
    expect(attestBlocker({ documentCount: 1, rows, invoiceAmount: 90000 })).toBeNull();
  });

  it("lets a split through while the total is unknown, for the export to check", () => {
    expect(
      attestBlocker({ documentCount: 1, rows: [{ amount: 50000 }, { amount: 40000 }], invoiceAmount: null }),
    ).toBeNull();
  });
});

describe("exportBlocker", () => {
  const ready = {
    fortnoxSupplierNumber: "12",
    invoiceNumber: "20417",
    invoiceDate: "2026-10-20",
    dueDate: "2026-11-10",
    amount: 125000,
    rows: [{ amount: null, account: "5615" }],
  };

  it("lets a complete invoice through", () => {
    expect(exportBlocker(ready)).toBeNull();
  });

  it.each([
    [{ fortnoxSupplierNumber: null }, "supplierInvoice.noSupplier"],
    [{ invoiceNumber: " " }, "supplierInvoice.noInvoiceNumber"],
    [{ invoiceDate: null }, "supplierInvoice.noInvoiceDate"],
    [{ dueDate: null }, "supplierInvoice.noDueDate"],
    [{ amount: null }, "supplierInvoice.noAmount"],
    [{ rows: [{ amount: null, account: null }] }, "supplierInvoice.allocationNoAccount"],
    [
      { rows: [{ amount: 100000, account: "5615" }, { amount: 20000, account: "5615" }] },
      "supplierInvoice.allocationSumMismatch",
    ],
  ])("refuses %o", (change, code) => {
    expect(exportBlocker({ ...ready, ...change })).toBe(code);
  });
});

describe("invoiceCapabilities", () => {
  it("lets the unit kontera, attest and send it back in one place", () => {
    expect(invoiceCapabilities(sexm, invoice())).toMatchObject({
      canKontera: true,
      canReturnToInbox: true,
      canMove: false,
      canEditDetails: false,
    });
    expect(invoiceCapabilities(cafe, invoice())).toMatchObject({ canKontera: false, canReturnToInbox: false });
  });

  it("lets triage kontera on a unit's behalf, move it, or take it back", () => {
    expect(invoiceCapabilities(triage, invoice())).toMatchObject({
      canKontera: true,
      canMove: true,
      canReturnToInbox: true,
    });
  });

  it("never moves or returns an invoice anybody has signed", () => {
    for (const status of ["PENDING_APPROVAL", "APPROVED", "EXPORTED"] as const) {
      expect(invoiceCapabilities(triage, invoice({ status }))).toMatchObject({
        canMove: false,
        canReturnToInbox: false,
      });
    }
  });

  it("asks another unit only for its unsigned share", () => {
    const split = invoice({
      status: "PENDING_APPROVAL",
      allocations: [
        { approved: true, approvedById: "klara", viewerMayAttest: false },
        { approved: false, viewerMayAttest: true },
      ],
    });
    expect(invoiceCapabilities(cafe, split)).toMatchObject({ canAttest: true, canRequestChanges: true, canKontera: false });
    // From Sexmästeriet's side the unsigned row is not theirs to sign.
    const fromSex = invoice({
      status: "PENDING_APPROVAL",
      allocations: [
        { approved: true, approvedById: "klara", viewerMayAttest: true },
        { approved: false, viewerMayAttest: false },
      ],
    });
    expect(invoiceCapabilities(sexm, fromSex).canAttest).toBe(false);
  });

  it("lets a signer take their own signature back until it is in Fortnox", () => {
    const signed = { approved: true, approvedById: "klara", viewerMayAttest: true };
    const klara = viewer(["ATTEST_VIEW"], ["unit-sex"], ["RESULTATANSVARIG"], "klara");
    expect(invoiceCapabilities(klara, invoice({ status: "APPROVED", allocations: [signed] })).canWithdrawAttest).toBe(true);
    expect(invoiceCapabilities(klara, invoice({ status: "EXPORTED", allocations: [signed] })).canWithdrawAttest).toBe(false);
    expect(invoiceCapabilities(sexm, invoice({ status: "APPROVED", allocations: [signed] })).canWithdrawAttest).toBe(false);
  });

  it("gives the details to the treasury until export, and never to a revisor", () => {
    expect(invoiceCapabilities(treasurer, invoice({ status: "APPROVED" }))).toMatchObject({
      canEditDetails: true,
      canRequestChanges: true,
    });
    expect(invoiceCapabilities(treasurer, invoice({ status: "EXPORTED" })).canEditDetails).toBe(false);
    expect(invoiceCapabilities(revisor, invoice({ status: "APPROVED" }))).toMatchObject({
      canEditDetails: false,
      canRequestChanges: false,
      canKontera: false,
    });
  });
});

describe("invoiceQueue", () => {
  it("sorts each invoice into the section of whoever has to act", () => {
    expect(invoiceQueue(sexm, invoice())).toBe("attest");
    expect(invoiceQueue(triage, invoice())).toBe("elsewhere");
    expect(invoiceQueue(treasurer, invoice({ status: "APPROVED" }))).toBe("export");
    expect(invoiceQueue(sexm, invoice({ status: "APPROVED" }))).toBe("elsewhere");
    expect(invoiceQueue(sexm, invoice({ status: "EXPORTED" }))).toBe("done");
  });

  it("puts a split on whoever still has a row to sign", () => {
    const split = invoice({
      status: "PENDING_APPROVAL",
      allocations: [
        { approved: true, viewerMayAttest: false },
        { approved: false, viewerMayAttest: true },
      ],
    });
    expect(invoiceQueue(cafe, split)).toBe("attest");
  });
});

describe("daysUntilDue", () => {
  it("counts whole days, negative once passed", () => {
    expect(daysUntilDue("2026-11-10", "2026-11-07")).toBe(3);
    expect(daysUntilDue("2026-11-10", "2026-11-10")).toBe(0);
    expect(daysUntilDue("2026-11-10", "2026-11-12")).toBe(-2);
    expect(daysUntilDue(null, "2026-11-12")).toBeNull();
  });
});
