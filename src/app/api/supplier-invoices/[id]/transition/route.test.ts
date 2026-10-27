import { beforeEach, describe, expect, it, vi } from "vitest";

// A levfaktura's way through the inkorg and the attest.
//
// Tested at the route, because what makes each step safe is here: the write
// restates the status it was decided under, a signature is only ever put on a
// row that is still unsigned, and the mail goes to the people the step is
// about. Mocked at the lowest layer, the session and the database, so the gate,
// the schema, the visibility rule and the capabilities are the real ones.

type Alloc = { id: string; approvedById: string | null; amount: number; account: string; costCenter: { code: string; name: string } };

const h = vi.hoisted(() => ({
  capabilities: [] as string[],
  roles: ["ORDINARIE"] as string[],
  ownedUnits: [] as string[],
  invoice: {} as Record<string, unknown>,
  allocations: [] as Alloc[],
  remaining: 0,
  invoiceUpdate: vi.fn(),
  allocationUpdate: vi.fn(),
  event: vi.fn(),
  notify: vi.fn(),
}));

vi.mock("@/lib/server/current-user", () => ({
  resolveUserId: async () => "actor",
  loadUser: async () => ({
    name: "Kassör",
    email: "k@dsek.se",
    studentId: "ka1234ss-s",
    roles: h.roles,
    capabilities: h.capabilities,
  }),
}));

vi.mock("@/lib/server/db", () => ({
  prisma: {
    supplierInvoice: {
      findFirst: async () => ({
        id: "inv1",
        status: "INBOX",
        resultUnitId: null,
        resultUnit: null,
        supplierName: "Lunds Släp AB",
        invoiceNumber: "20417",
        description: null,
        amount: 125000,
        dueDate: new Date("2026-11-10"),
        _count: { documents: 1 },
        ...h.invoice,
        allocations: h.allocations,
      }),
    },
    resultUnit: {
      findUnique: async () => ({ id: "unit-sex", name: "Sexmästeriet" }),
      findMany: async () => [],
    },
    user: { findMany: async () => [{ id: "chief" }] },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        supplierInvoice: { updateMany: h.invoiceUpdate },
        supplierInvoiceAllocation: {
          updateMany: h.allocationUpdate,
          count: async () => h.remaining,
        },
        supplierInvoiceEvent: { create: h.event },
      }),
  },
}));

vi.mock("@/lib/server/result-units", () => ({
  ownedResultUnits: async () => ({
    names: h.ownedUnits,
    prefixes: h.ownedUnits.length ? ["SEX"] : [],
  }),
  getPrefixes: async () => [{ value: "SEX", resultUnitId: "unit-sex", resultUnitName: "Sexmästeriet" }],
  resultUnitNameForCode: (code: string) => (code.startsWith("SEX") ? "Sexmästeriet" : null),
  costCentreWhereForPrefixes: (prefixes: string[]) => ({ OR: prefixes.map((p) => ({ code: { startsWith: p } })) }),
}));

vi.mock("@/lib/server/notify", () => ({
  notify: h.notify,
  attestersOf: async () => ["chief"],
  deliverSoon: () => {},
}));

const { POST } = await import("./route");

const call = (body: object) =>
  POST(
    new Request("http://test/api/supplier-invoices/inv1/transition", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "inv1" }) },
  );

const row = (over: Partial<Alloc> = {}): Alloc => ({
  id: "a1",
  approvedById: null,
  amount: 125000,
  account: "5615",
  costCenter: { code: "SEX01", name: "Sexmästeriet" },
  ...over,
});

beforeEach(() => {
  h.capabilities = [];
  h.roles = ["ORDINARIE"];
  h.ownedUnits = [];
  h.invoice = {};
  h.allocations = [];
  h.remaining = 0;
  for (const fn of [h.invoiceUpdate, h.allocationUpdate, h.event, h.notify]) {
    fn.mockReset();
    fn.mockResolvedValue({ count: 1 });
  }
});

describe("assign", () => {
  it("gives an inkorg invoice to a unit and mails its resultatansvarig", async () => {
    h.capabilities = ["INVOICE_TRIAGE"];
    const res = await call({ action: "assign", resultUnitId: "unit-sex" });

    expect(res.status).toBe(200);
    expect(h.invoiceUpdate).toHaveBeenCalledWith({
      where: { id: "inv1", status: "INBOX" },
      data: expect.objectContaining({ status: "ASSIGNED", resultUnitId: "unit-sex", assignedById: "actor" }),
    });
    expect(h.event.mock.calls[0][0].data).toMatchObject({
      type: "ASSIGNED",
      diff: { from: null, to: "Sexmästeriet" },
    });
    expect(h.notify).toHaveBeenCalledWith(
      expect.anything(),
      "SUPPLIER_INVOICE_ASSIGNED",
      ["chief"],
      expect.anything(),
      { exclude: ["actor"] },
    );
  });

  it("is triage's alone", async () => {
    h.capabilities = ["BOOKKEEPING"];
    const res = await call({ action: "assign", resultUnitId: "unit-sex" });
    expect(res.status).toBe(403);
    expect(h.invoiceUpdate).not.toHaveBeenCalled();
  });

  it("answers 409 when somebody moved it first", async () => {
    h.capabilities = ["INVOICE_TRIAGE"];
    h.invoiceUpdate.mockResolvedValue({ count: 0 });
    const res = await call({ action: "assign", resultUnitId: "unit-sex" });
    expect(res.status).toBe(409);
    expect(h.notify).not.toHaveBeenCalled();
  });
});

describe("submit", () => {
  beforeEach(() => {
    h.roles = ["RESULTATANSVARIG"];
    h.capabilities = ["ATTEST_VIEW"];
    h.ownedUnits = ["Sexmästeriet"];
    h.invoice = { status: "ASSIGNED", resultUnitId: "unit-sex", resultUnit: { name: "Sexmästeriet" } };
  });

  it("refuses a kontering that does not add up", async () => {
    h.allocations = [row({ amount: 100000 })];
    const res = await call({ action: "submit" });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("supplierInvoice.allocationSumMismatch");
    expect(h.invoiceUpdate).not.toHaveBeenCalled();
  });

  it("sends a complete one for attest and clears any old signature", async () => {
    h.allocations = [row()];
    const res = await call({ action: "submit" });
    expect(res.status).toBe(200);
    expect(h.invoiceUpdate).toHaveBeenCalledWith({
      where: { id: "inv1", status: "ASSIGNED" },
      data: { status: "PENDING_APPROVAL" },
    });
    expect(h.allocationUpdate).toHaveBeenCalledWith({
      where: { invoiceId: "inv1" },
      data: { approvedById: null, approvedAt: null },
    });
    expect(h.notify.mock.calls[0][1]).toBe("SUPPLIER_INVOICE_SUBMITTED");
  });

  it("is not another unit's to send", async () => {
    h.ownedUnits = [];
    h.allocations = [row()];
    const res = await call({ action: "submit" });
    expect(res.status).toBe(403);
  });
});

describe("approve", () => {
  beforeEach(() => {
    h.roles = ["RESULTATANSVARIG"];
    h.capabilities = ["ATTEST_VIEW"];
    h.ownedUnits = ["Sexmästeriet"];
    h.invoice = { status: "PENDING_APPROVAL", resultUnitId: "unit-sex", resultUnit: { name: "Sexmästeriet" } };
  });

  it("signs only the viewer's unsigned rows, and finishes on the last", async () => {
    h.allocations = [
      row({ id: "a1" }),
      row({ id: "a2", costCenter: { code: "CAFE01", name: "Caféet" } }),
      row({ id: "a3", approvedById: "someone" }),
    ];
    const res = await call({ action: "approve" });
    expect(res.status).toBe(200);
    expect(h.allocationUpdate).toHaveBeenCalledWith({
      where: { id: { in: ["a1"] }, approvedById: null },
      data: expect.objectContaining({ approvedById: "actor" }),
    });
    expect((await res.json()).status).toBe("APPROVED");
    expect(h.invoiceUpdate).toHaveBeenCalledWith({
      where: { id: "inv1", status: "PENDING_APPROVAL" },
      data: { status: "APPROVED" },
    });
  });

  it("leaves it waiting while another unit still has to sign", async () => {
    h.allocations = [row({ id: "a1" }), row({ id: "a2", costCenter: { code: "CAFE01", name: "Caféet" } })];
    h.remaining = 1;
    const res = await call({ action: "approve" });
    expect((await res.json()).status).toBe("PENDING_APPROVAL");
    expect(h.invoiceUpdate).not.toHaveBeenCalled();
  });

  it("refuses when nothing on it is the viewer's to sign", async () => {
    h.allocations = [row({ costCenter: { code: "CAFE01", name: "Caféet" } })];
    const res = await call({ action: "approve" });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("supplierInvoice.nothingToApprove");
  });
});

describe("request_changes", () => {
  it("needs a comment", async () => {
    h.roles = ["RESULTATANSVARIG"];
    h.capabilities = ["ATTEST_VIEW"];
    h.ownedUnits = ["Sexmästeriet"];
    h.invoice = { status: "PENDING_APPROVAL", resultUnitId: "unit-sex", resultUnit: { name: "Sexmästeriet" } };
    h.allocations = [row()];
    const res = await call({ action: "request_changes" });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("supplierInvoice.commentRequired");
  });
});
