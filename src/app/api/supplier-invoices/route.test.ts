import { beforeEach, describe, expect, it, vi } from "vitest";

// Making an invoice from an Inkorg document is deciding whose it is: the unit
// is required, and the invoice is born given to it.

const h = vi.hoisted(() => ({
  create: vi.fn(),
  attach: vi.fn(),
  notify: vi.fn(),
  unit: { id: "sex", name: "Sexmästeriet" } as { id: string; name: string } | null,
}));

vi.mock("@/lib/server/current-user", () => ({
  resolveUserId: async () => "maja",
  loadUser: async () => ({
    name: "Maja",
    email: "m@dsek.se",
    studentId: "x",
    roles: [],
    capabilities: ["INVOICE_TRIAGE"],
  }),
}));

vi.mock("@/lib/server/db", () => ({
  prisma: {
    supplierInvoiceDocument: {
      findUnique: async () => ({
        id: "d1",
        invoiceId: null,
        objectKey: "k",
        mimeType: "application/pdf",
        uploadedById: "maja",
        inboundMail: null,
      }),
    },
    resultUnit: { findUnique: async () => h.unit },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ supplierInvoice: { create: h.create } }),
  },
}));

vi.mock("@/lib/server/invoice-documents", () => ({
  DocumentTaken: class extends Error {},
  attachDocument: h.attach,
  readLooseDocument: async () => ({}),
}));
vi.mock("@/lib/server/notify", () => ({ notify: h.notify, deliverSoon: () => {} }));
vi.mock("@/lib/api/supplier-invoice-access", () => ({ unitOwnersOf: async () => ["klara"] }));

const { POST } = await import("./route");
const call = (body: object) =>
  POST(
    new Request("http://test/api/supplier-invoices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

beforeEach(() => {
  h.unit = { id: "sex", name: "Sexmästeriet" };
  for (const fn of [h.create, h.attach, h.notify]) fn.mockReset();
  h.create.mockResolvedValue({ id: "inv1" });
});

describe("making an invoice from the Inkorg", () => {
  it("is refused without a unit", async () => {
    expect((await call({ documentId: "d1" })).status).toBe(422);
    expect(h.create).not.toHaveBeenCalled();
  });

  it("is refused for a unit that does not exist", async () => {
    h.unit = null;
    const res = await call({ documentId: "d1", resultUnitId: "nope" });
    expect((await res.json()).error).toBe("supplierInvoice.unknownResultUnit");
  });

  it("makes it already given to the unit, and tells the unit", async () => {
    const res = await call({ documentId: "d1", resultUnitId: "sex" });
    expect(res.status).toBe(201);
    expect(h.create.mock.calls[0][0].data).toMatchObject({
      status: "ASSIGNED",
      resultUnitId: "sex",
      assignedById: "maja",
    });
    expect(h.attach).toHaveBeenCalled();
    expect(h.notify.mock.calls[0][1]).toBe("SUPPLIER_INVOICE_ASSIGNED");
  });
});
