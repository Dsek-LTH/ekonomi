import { beforeEach, describe, expect, it, vi } from "vitest";

// An invoice is born when its unit fördelar a document in its Inkorg: only a
// document given to a unit, only by someone who may fördela it, and with the
// sender's own rows signed as it is made.

const h = vi.hoisted(() => ({
  create: vi.fn(),
  claim: vi.fn(),
  notify: vi.fn(),
  plan: vi.fn(),
  access: null as unknown,
}));

// The year picked in the header is its own test (lib/api/fiscal-year.test.ts).
vi.mock("@/lib/api/fiscal-year", () => ({ denyOutsideFiscalYear: async () => null }));
vi.mock("@/lib/server/current-user", () => ({
  resolveUserId: async () => "maja",
  loadUser: async () => ({
    name: "Maja",
    email: "m@dsek.se",
    studentId: "x",
    roles: ["RESULTATANSVARIG"],
    capabilities: [],
  }),
}));

vi.mock("@/lib/server/db", () => ({
  prisma: {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        supplierInvoice: {
          create: h.create,
          // The year's last number, which the new one counts on from.
          findFirst: async () => ({ reference: "LEV26-0011" }),
        },
        supplierInvoiceDocument: { updateMany: h.claim },
      }),
  },
}));

vi.mock("@/lib/server/invoice-documents", () => ({
  readDocumentScan: async () => ({ fields: { invoiceNumber: "F-77" }, supplier: null }),
}));
vi.mock("@/lib/server/invoice-allocation", () => ({ planAllocation: h.plan }));
vi.mock("@/lib/server/notify", () => ({ notify: h.notify, deliverSoon: () => {} }));
vi.mock("@/lib/api/supplier-invoice-access", () => ({ loadInboxDocumentFor: async () => h.access }));

const { POST } = await import("./route");
const call = (body: object) =>
  POST(
    new Request("http://test/api/supplier-invoices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

const assignedAt = new Date("2026-10-20T08:00:00Z");
const doc = {
  id: "d1",
  invoiceId: null,
  createdAt: new Date("2026-10-19T08:00:00Z"),
  uploadedById: "kassor",
  resultUnitId: "sex",
  assignedById: "kassor",
  assignedAt,
  resultUnit: { id: "sex", name: "Sexmästeriet" },
  inboundMail: null,
};
const allowed = { canAllocate: true, canDecline: true, canAssign: false, canDelete: false, canSee: true };
const body = {
  documentId: "d1",
  rows: [{ costCenterCode: "SEX1" }],
  amount: 125000,
  dueDate: "2026-11-15",
  description: "Hyra av släp",
};

const row = (code: string, signed: boolean) => ({
  code,
  data: { costCenterId: code, amount: null, comment: null, position: 0, approvedById: signed ? "maja" : null, approvedAt: null },
});

beforeEach(() => {
  h.access = { ok: true, doc, viewer: {}, can: allowed };
  for (const fn of [h.create, h.claim, h.notify, h.plan]) fn.mockReset();
  h.create.mockImplementation(async ({ data }) => ({ id: "inv1", allocations: [], ...data }));
  h.claim.mockResolvedValue({ count: 1 });
  h.plan.mockResolvedValue({
    ok: true,
    plan: { planned: [row("SEX1", true)], signed: ["SEX1"], status: "APPROVED", attesters: [] },
  });
});

describe("making an invoice by fördelning a document", () => {
  it("is refused for a document no unit has been given", async () => {
    h.access = { ok: true, doc: { ...doc, resultUnitId: null, resultUnit: null }, viewer: {}, can: { ...allowed, canAllocate: false } };
    const res = await call(body);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("supplierInvoice.documentNotAssigned");
    expect(h.create).not.toHaveBeenCalled();
  });

  it("is refused for somebody who may not fördela it", async () => {
    h.access = { ok: true, doc, viewer: {}, can: { ...allowed, canAllocate: false } };
    expect((await call(body)).status).toBe(403);
    expect(h.create).not.toHaveBeenCalled();
  });

  it("makes it attested for the unit's own rows, with the document's history first", async () => {
    const res = await call(body);
    expect(res.status).toBe(201);
    const data = h.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      reference: expect.stringMatching(/^LEV\d{2}-\d{4}$/),
      status: "APPROVED",
      resultUnitId: "sex",
      assignedById: "kassor",
      amount: 125000,
      description: "Hyra av släp",
      // What the PDF said fills what the unit did not type.
      invoiceNumber: "F-77",
      prefilled: ["invoiceNumber"],
    });
    expect(data.events.create.map((e: { type: string }) => e.type)).toEqual([
      "RECEIVED",
      "ASSIGNED",
      "COST_CENTER_APPROVED",
      "APPROVED",
    ]);
    expect(data.events.create[1].createdAt).toBe(assignedAt);
    // The document is claimed out of that unit's Inkorg, and no longer the unit's.
    expect(h.claim).toHaveBeenCalledWith({
      where: { id: "d1", invoiceId: null, resultUnitId: "sex" },
      data: expect.objectContaining({ invoiceId: "inv1", resultUnitId: null }),
    });
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("asks another unit to sign its share of a split", async () => {
    h.plan.mockResolvedValue({
      ok: true,
      plan: {
        planned: [row("SEX1", true), row("CAF1", false)],
        signed: ["SEX1"],
        status: "PENDING_APPROVAL",
        attesters: ["olle"],
      },
    });
    const res = await call(body);
    expect(await res.json()).toMatchObject({ status: "PENDING_APPROVAL" });
    expect(h.notify.mock.calls[0][1]).toBe("SUPPLIER_INVOICE_SUBMITTED");
    expect(h.notify.mock.calls[0][2]).toEqual(["olle"]);
  });

  it("is a 409 when the document was fördelad or moved meanwhile", async () => {
    h.claim.mockResolvedValue({ count: 0 });
    const res = await call(body);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("supplierInvoice.changedMeanwhile");
  });
});
