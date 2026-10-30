import { describe, expect, it } from "vitest";
import {
  attestBlocker,
  bookedShares,
  daysUntilDue,
  documentCapabilities,
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
    rounding: null,
    shares: [null],
    lines: [{ account: "5615", debit: 125000, credit: 0 }],
  };

  it("lets a complete invoice through", () => {
    expect(exportBlocker(ready)).toBeNull();
  });

  it("counts the rounding and any credit line into what is booked", () => {
    expect(
      exportBlocker({
        ...ready,
        rounding: 44,
        lines: [
          { account: "5615", debit: 130000, credit: 0 },
          { account: "5615", debit: 0, credit: 5044 },
        ],
      }),
    ).toBeNull();
  });

  it.each([
    [{ fortnoxSupplierNumber: null }, "supplierInvoice.noSupplier"],
    [{ invoiceNumber: " " }, "supplierInvoice.noInvoiceNumber"],
    [{ invoiceDate: null }, "supplierInvoice.noInvoiceDate"],
    [{ dueDate: null }, "supplierInvoice.noDueDate"],
    [{ amount: null }, "supplierInvoice.noAmount"],
    [{ shares: [100000, 20000] }, "supplierInvoice.allocationSumMismatch"],
    [{ lines: [] }, "supplierInvoice.noLines"],
    [{ lines: [{ account: "", debit: 125000, credit: 0 }] }, "supplierInvoice.lineNoAccount"],
    [{ lines: [{ account: "5615", debit: 0, credit: 0 }] }, "supplierInvoice.lineNoAmount"],
    [{ lines: [{ account: "5615", debit: 120000, credit: 0 }] }, "supplierInvoice.unbalanced"],
  ])("refuses %o", (change, code) => {
    expect(exportBlocker({ ...ready, ...change })).toBe(code);
  });
});

describe("invoiceCapabilities", () => {
  it("lets the unit fördela it and send it back, and nothing of the treasury's", () => {
    expect(invoiceCapabilities(sexm, invoice())).toMatchObject({
      canAllocate: true,
      canReturnToInbox: true,
      canMove: false,
      canBook: false,
    });
    expect(invoiceCapabilities(cafe, invoice())).toMatchObject({ canAllocate: false, canReturnToInbox: false });
  });

  it("lets triage fördela on a unit's behalf, move it, or take it back", () => {
    expect(invoiceCapabilities(triage, invoice())).toMatchObject({
      canAllocate: true,
      canMove: true,
      canReturnToInbox: true,
    });
  });

  it("never moves or returns an invoice anybody has signed", () => {
    for (const status of ["PENDING_APPROVAL", "APPROVED", "BOOKED", "EXPORTED"] as const) {
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
    expect(invoiceCapabilities(cafe, split)).toMatchObject({ canAttest: true, canRequestChanges: true, canAllocate: false });
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
    expect(invoiceCapabilities(klara, invoice({ status: "BOOKED", allocations: [signed] })).canWithdrawAttest).toBe(true);
    expect(invoiceCapabilities(klara, invoice({ status: "EXPORTED", allocations: [signed] })).canWithdrawAttest).toBe(false);
    expect(invoiceCapabilities(sexm, invoice({ status: "APPROVED", allocations: [signed] })).canWithdrawAttest).toBe(false);
  });

  it("lets the unit that proposed a split reopen it while others sign, and nobody else", () => {
    const waiting = invoice({
      status: "PENDING_APPROVAL",
      allocations: [
        { approved: true, approvedById: "klara", viewerMayAttest: false },
        { approved: false, viewerMayAttest: false },
      ],
    });
    expect(invoiceCapabilities(sexm, waiting).canRedistribute).toBe(true);
    expect(invoiceCapabilities(triage, waiting).canRedistribute).toBe(true);
    expect(invoiceCapabilities(cafe, waiting).canRedistribute).toBe(false);
    // Fully attested, the way back is the treasury's request for changes.
    expect(invoiceCapabilities(sexm, invoice({ status: "APPROVED" })).canRedistribute).toBe(false);
  });

  it("gives the kontering to the treasury until it is sent, and never to a revisor", () => {
    expect(invoiceCapabilities(treasurer, invoice({ status: "APPROVED" }))).toMatchObject({
      canBook: true,
      canSend: false,
      canRequestChanges: true,
    });
    expect(invoiceCapabilities(treasurer, invoice({ status: "BOOKED" }))).toMatchObject({
      canBook: true,
      canSend: true,
      canRequestChanges: true,
    });
    expect(invoiceCapabilities(treasurer, invoice({ status: "EXPORTED" }))).toMatchObject({
      canBook: false,
      canSend: false,
    });
    expect(invoiceCapabilities(treasurer, invoice({ status: "PENDING_APPROVAL" })).canBook).toBe(false);
    expect(invoiceCapabilities(revisor, invoice({ status: "BOOKED" }))).toMatchObject({
      canBook: false,
      canSend: false,
      canRequestChanges: false,
      canAllocate: false,
    });
  });
});

describe("invoiceQueue", () => {
  it("sorts each invoice into the section of whoever has to act", () => {
    expect(invoiceQueue(sexm, invoice())).toBe("attest");
    expect(invoiceQueue(triage, invoice())).toBe("elsewhere");
    expect(invoiceQueue(treasurer, invoice({ status: "APPROVED" }))).toBe("export");
    expect(invoiceQueue(treasurer, invoice({ status: "BOOKED" }))).toBe("export");
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

describe("bookedShares", () => {
  it("leaves the shares as they are without a rounding", () => {
    expect(bookedShares([100_00, 50_00], 0)).toEqual([100_00, 50_00]);
  });

  it("takes the rounding on the largest share, so cost and rounding make the amount to pay", () => {
    // Lines of 1 234,56 rounded to 1 234,00 to pay: -0,56 rounding, the cost
    // booked is 0,56 more than attested.
    const shares = [1000_00, 234_00];
    const booked = bookedShares(shares, -56);
    expect(booked).toEqual([1000_56, 234_00]);
    expect(booked.reduce((a, b) => a + b, 0) + -56).toBe(1234_00);
  });

  it("picks the first of equal shares", () => {
    expect(bookedShares([50_00, 50_00], 10)).toEqual([49_90, 50_00]);
  });
});

describe("documentCapabilities", () => {
  const given = { resultUnitId: "unit-sex" };
  const loose = { resultUnitId: null };

  it("lets the unit fördela what it was given, or say it is not theirs", () => {
    expect(documentCapabilities(sexm, given)).toMatchObject({
      canSee: true,
      canAllocate: true,
      canDecline: true,
      canAssign: false,
      canDelete: false,
    });
  });

  it("keeps another unit's documents from a resultatansvarig", () => {
    expect(documentCapabilities(cafe, given).canSee).toBe(false);
    expect(documentCapabilities(sexm, loose).canSee).toBe(false);
  });

  it("lets triage give out, move and delete, and fördela only once there is a unit", () => {
    expect(documentCapabilities(triage, loose)).toMatchObject({
      canSee: true,
      canAssign: true,
      canDelete: true,
      canAllocate: false,
      canDecline: false,
    });
    expect(documentCapabilities(triage, given).canAllocate).toBe(true);
  });

  it("shows nothing to somebody with neither", () => {
    expect(documentCapabilities(revisor, given).canSee).toBe(false);
  });
});
