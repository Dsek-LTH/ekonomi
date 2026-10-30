import { beforeEach, describe, expect, it, vi } from "vitest";

// The Inkorg's rule for files: a document is only ever deleted from the
// Inkorg. Taken off an invoice, it goes back there; an invoice sent back to
// the Inkorg, its documents go back there too, saying why.

const h = vi.hoisted(() => ({
  capabilities: ["INVOICE_TRIAGE"] as string[],
  doc: { id: "d1", invoiceId: null as string | null, objectKey: "k", filename: "f.pdf" },
  locked: { invoiceId: null as string | null },
  canEditDocuments: true,
  canReturn: true,
  deleteObject: vi.fn(),
  docDelete: vi.fn(),
  docUpdateMany: vi.fn(),
  invoiceDeleteMany: vi.fn(),
  event: vi.fn(),
}));

vi.mock("@/lib/server/current-user", () => ({
  resolveUserId: async () => "maja",
  loadUser: async () => ({ name: "Maja", email: "m@dsek.se", studentId: "x", roles: [], capabilities: h.capabilities }),
}));

vi.mock("@/lib/server/db", () => {
  const tx = {
    $queryRaw: async () => [h.locked],
    supplierInvoiceDocument: { delete: h.docDelete, updateMany: h.docUpdateMany },
    supplierInvoice: { deleteMany: h.invoiceDeleteMany },
    supplierInvoiceEvent: { create: h.event },
  };
  return {
    prisma: {
      supplierInvoiceDocument: { findUnique: async () => h.doc },
      $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
    },
  };
});

vi.mock("@/lib/server/storage", () => ({ deleteObject: h.deleteObject, getObjectStream: vi.fn() }));

vi.mock("@/lib/api/supplier-invoice-access", () => ({
  loadInvoiceFor: async () => ({
    ok: true,
    invoice: { id: "inv1", status: "ASSIGNED", resultUnit: { name: "Sexmästeriet" } },
    can: { canEditDocuments: h.canEditDocuments, canReturnToInbox: h.canReturn },
  }),
  refuseChange: () => new Response(JSON.stringify({ error: "supplierInvoice.denied" }), { status: 403 }),
}));

const { DELETE } = await import("./route");
const { POST: RETURN } = await import("@/app/api/supplier-invoices/[id]/return/route");

const params = { params: Promise.resolve({ id: "d1" }) };
const req = (method: string) => new Request("http://test/x", { method });

beforeEach(() => {
  h.capabilities = ["INVOICE_TRIAGE"];
  h.doc = { id: "d1", invoiceId: null, objectKey: "k", filename: "f.pdf" };
  h.locked = { invoiceId: null };
  h.canEditDocuments = true;
  h.canReturn = true;
  for (const fn of [h.deleteObject, h.docDelete, h.docUpdateMany, h.invoiceDeleteMany, h.event]) {
    fn.mockReset();
    fn.mockResolvedValue({ count: 1 });
  }
});

describe("deleting a document", () => {
  it("deletes one in the Inkorg, file first", async () => {
    const res = await DELETE(req("DELETE"), params);
    expect(res.status).toBe(204);
    expect(h.deleteObject).toHaveBeenCalledWith("k");
    expect(h.docDelete).toHaveBeenCalledWith({ where: { id: "d1" } });
  });

  it("refuses one that is on an invoice", async () => {
    h.doc = { ...h.doc, invoiceId: "inv1" };
    const res = await DELETE(req("DELETE"), params);
    expect(res.status).toBe(409);
    expect(h.deleteObject).not.toHaveBeenCalled();
  });

  it("refuses one put on an invoice while the request was on its way", async () => {
    h.locked = { invoiceId: "inv1" };
    const res = await DELETE(req("DELETE"), params);
    expect(res.status).toBe(409);
    expect(h.deleteObject).not.toHaveBeenCalled();
  });

  it("keeps the row when storage would not let the file go", async () => {
    h.deleteObject.mockRejectedValue(new Error("down"));
    expect((await DELETE(req("DELETE"), params)).status).toBe(503);
    expect(h.docDelete).not.toHaveBeenCalled();
  });

  it("is triage's alone", async () => {
    h.capabilities = ["BOOKKEEPING"];
    expect((await DELETE(req("DELETE"), params)).status).toBe(403);
  });
});

describe("sending an invoice back to the Inkorg", () => {
  const send = (reason?: string) =>
    RETURN(
      new Request("http://test/x", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reason === undefined ? {} : { reason }),
      }),
      { params: Promise.resolve({ id: "inv1" }) },
    );

  it("needs a reason", async () => {
    expect((await send()).status).toBe(422);
    expect(h.invoiceDeleteMany).not.toHaveBeenCalled();
  });

  it("puts its documents back with the unit and the reason, and removes the invoice", async () => {
    const res = await send("Det här är Caféets");
    expect(res.status).toBe(204);
    expect(h.docUpdateMany).toHaveBeenCalledWith({
      where: { invoiceId: "inv1" },
      data: { invoiceId: null, position: 0, returnedFrom: "Sexmästeriet", returnNote: "Det här är Caféets" },
    });
    expect(h.invoiceDeleteMany).toHaveBeenCalledWith({ where: { id: "inv1", status: "ASSIGNED" } });
    expect(h.deleteObject).not.toHaveBeenCalled();
  });

  it("is refused once anybody has signed it", async () => {
    h.canReturn = false;
    expect((await send("x")).status).toBe(403);
    expect(h.docUpdateMany).not.toHaveBeenCalled();
  });
});
