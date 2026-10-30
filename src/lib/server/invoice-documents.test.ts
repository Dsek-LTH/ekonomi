import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/storage", () => ({ getObjectBuffer: vi.fn(async () => ({ bytes: new Uint8Array() })) }));
vi.mock("@/lib/server/supplier-register", () => ({ supplierMatcher: vi.fn(async () => () => null) }));
vi.mock("@/lib/server/invoice-prefill", () => ({ readInvoicePdf: vi.fn() }));
vi.mock("@/lib/server/db", () => ({
  prisma: { supplierInvoiceDocument: { findMany: vi.fn(), update: vi.fn() } },
}));

const storage = await import("@/lib/server/storage");
const prefill = await import("@/lib/server/invoice-prefill");
const { prisma } = await import("@/lib/server/db");
const { attachDocument, DocumentTaken, readInvoiceScan, scanOf } = await import("./invoice-documents");

// A document moving from the Inkorg onto an invoice: claimed only while it is
// still in the Inkorg, and put last. Nothing is read off it on the way.
function fakeTx(claimed: number, lastPosition: number | null) {
  return {
    supplierInvoiceDocument: {
      aggregate: vi.fn(async () => ({ _max: { position: lastPosition } })),
      updateMany: vi.fn(async () => ({ count: claimed })),
    },
    supplierInvoice: { update: vi.fn() },
  };
}

const doc = { id: "d1", objectKey: "k", mimeType: "application/pdf", scan: {}, scannedAt: new Date() };

describe("attachDocument", () => {
  it("claims it out of the Inkorg, last among the invoice's documents", async () => {
    const tx = fakeTx(1, 2);
    await attachDocument(tx as never, doc, { id: "inv1" });
    expect(tx.supplierInvoiceDocument.updateMany).toHaveBeenCalledWith({
      where: { id: "d1", invoiceId: null },
      data: {
        invoiceId: "inv1",
        position: 3,
        resultUnitId: null,
        assignedById: null,
        assignedAt: null,
        returnedFrom: null,
        returnNote: null,
      },
    });
    expect(tx.supplierInvoice.update).not.toHaveBeenCalled();
  });

  it("refuses a document somebody else took first", async () => {
    await expect(attachDocument(fakeTx(0, null) as never, doc, { id: "inv1" })).rejects.toBeInstanceOf(DocumentTaken);
  });
});

describe("scanOf", () => {
  it("uses the scan already kept, without fetching it", async () => {
    expect(await scanOf({ ...doc, scan: { amount: 100 } })).toEqual({ amount: 100 });
    expect(storage.getObjectBuffer).not.toHaveBeenCalled();
  });
});

describe("readInvoiceScan", () => {
  it("reads what was not read before, keeps it, and believes the first document", async () => {
    vi.mocked(prisma.supplierInvoiceDocument.findMany).mockResolvedValue([
      { ...doc, id: "d1", scan: null, scannedAt: null },
      { ...doc, id: "d2", scan: { amount: 999, ocr: "123" }, scannedAt: new Date() },
    ] as never);
    vi.mocked(prefill.readInvoicePdf).mockResolvedValue({ amount: 125000, invoiceNumber: "20417" });

    const reading = await readInvoiceScan("inv1");

    expect(reading.fields).toEqual({ amount: 125000, invoiceNumber: "20417", ocr: "123" });
    expect(prisma.supplierInvoiceDocument.update).toHaveBeenCalledTimes(1);
    expect(prisma.supplierInvoiceDocument.update).toHaveBeenCalledWith({
      where: { id: "d1" },
      data: { scan: { amount: 125000, invoiceNumber: "20417" }, scannedAt: expect.any(Date) },
    });
  });
});
