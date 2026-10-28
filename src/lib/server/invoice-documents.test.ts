import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/storage", () => ({ getObjectBuffer: vi.fn() }));

const { attachDocument, DocumentTaken } = await import("./invoice-documents");

// A document moving from the Inkorg onto an invoice: claimed only while it is
// still in the Inkorg, put last, and filling only what the invoice lacks.
function fakeTx(claimed: number, lastPosition: number | null) {
  return {
    supplierInvoiceDocument: {
      aggregate: vi.fn(async () => ({ _max: { position: lastPosition } })),
      updateMany: vi.fn(async () => ({ count: claimed })),
    },
    supplierInvoice: { update: vi.fn() },
  };
}

const doc = { id: "d1", objectKey: "k", mimeType: "application/pdf" };

describe("attachDocument", () => {
  it("claims it out of the Inkorg, last among the invoice's documents", async () => {
    const tx = fakeTx(1, 2);
    await attachDocument(tx as never, doc, { id: "inv1", prefilled: [] }, {});
    expect(tx.supplierInvoiceDocument.updateMany).toHaveBeenCalledWith({
      where: { id: "d1", invoiceId: null },
      data: { invoiceId: "inv1", position: 3, returnedFrom: null, returnNote: null },
    });
    expect(tx.supplierInvoice.update).not.toHaveBeenCalled();
  });

  it("fills only what the invoice is still missing", async () => {
    const tx = fakeTx(1, null);
    await attachDocument(tx as never, doc, { id: "inv1", amount: 5000, invoiceNumber: null, prefilled: [] }, {
      amount: 125000,
      invoiceNumber: "20417",
    });
    expect(tx.supplierInvoice.update).toHaveBeenCalledWith({
      where: { id: "inv1" },
      data: { invoiceNumber: "20417", prefilled: ["invoiceNumber"] },
    });
  });

  it("refuses a document somebody else took first", async () => {
    await expect(attachDocument(fakeTx(0, null) as never, doc, { id: "inv1" }, {})).rejects.toBeInstanceOf(
      DocumentTaken,
    );
  });
});
