import { beforeEach, describe, expect, it, vi } from "vitest";

// A levfaktura's way through the inkorg and the attest.
//
// Tested at the route, because what makes each step safe is here: the write
// restates the status it was decided under, a signature is only ever put on a
// row that is still unsigned, and the mail goes to the people the step is
// about. Mocked at the lowest layer, the session and the database, so the gate,
// the schema, the visibility rule and the capabilities are the real ones.

type Alloc = {
  id: string;
  approvedById: string | null;
  amount: number | null;
  account: string | null;
  costCenter: { code: string; name: string };
};

const h = vi.hoisted(() => ({
  capabilities: [] as string[],
  roles: ["ORDINARIE"] as string[],
  ownedUnits: [] as string[],
  invoice: {} as Record<string, unknown>,
  allocations: [] as Alloc[],
  remaining: 0,
  invoiceUpdate: vi.fn(),
  allocationUpdate: vi.fn(),
  allocationDelete: vi.fn(),
  allocationCreate: vi.fn(),
  event: vi.fn(),
  notify: vi.fn(),
  attesters: [] as string[],
}));

vi.mock("@/lib/server/current-user", () => ({
  resolveUserId: async () => "actor",
  loadUser: async () => ({
    name: "Klara",
    email: "k@dsek.se",
    studentId: "kl1234ss-s",
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
        supplierName: null,
        invoiceNumber: null,
        description: "Släp",
        amount: null,
        dueDate: null,
        _count: { documents: 1 },
        ...h.invoice,
        allocations: h.allocations,
      }),
    },
    resultUnit: {
      findUnique: async () => ({ id: "unit-sex", name: "Sexmästeriet" }),
      findMany: async () => [],
    },
    costCenter: {
      findMany: async ({ where }: { where: { code: { in: string[] } } }) =>
        where.code.in.map((code, i) => ({ id: `cc-${i}-${code}`, code, active: true })),
    },
    user: { findMany: async () => [{ id: "chief" }] },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        supplierInvoice: { updateMany: h.invoiceUpdate },
        supplierInvoiceAllocation: {
          updateMany: h.allocationUpdate,
          deleteMany: h.allocationDelete,
          createMany: h.allocationCreate,
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
  getPrefixes: async () => [
    { value: "SEX", resultUnitId: "unit-sex", resultUnitName: "Sexmästeriet" },
    { value: "CAFE", resultUnitId: "unit-cafe", resultUnitName: "Caféutskottet" },
  ],
  resultUnitNameForCode: (code: string) =>
    code.startsWith("SEX") ? "Sexmästeriet" : code.startsWith("CAFE") ? "Caféutskottet" : null,
  costCentreWhereForPrefixes: (prefixes: string[]) => ({
    OR: prefixes.map((p) => ({ code: { startsWith: p } })),
  }),
}));

vi.mock("@/lib/server/notify", () => ({
  notify: h.notify,
  attestersOf: async () => h.attesters,
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
  amount: null,
  account: null,
  costCenter: { code: "SEX01", name: "Sexmästeriet" },
  ...over,
});

const asSexmastare = () => {
  h.roles = ["RESULTATANSVARIG"];
  h.capabilities = ["ATTEST_VIEW"];
  h.ownedUnits = ["Sexmästeriet"];
};

beforeEach(() => {
  h.capabilities = [];
  h.roles = ["ORDINARIE"];
  h.ownedUnits = [];
  h.invoice = {};
  h.allocations = [];
  h.remaining = 0;
  h.attesters = [];
  for (const fn of [h.invoiceUpdate, h.allocationUpdate, h.allocationDelete, h.allocationCreate, h.event, h.notify]) {
    fn.mockReset();
    fn.mockResolvedValue({ count: 1 });
  }
});

const assigned = { status: "ASSIGNED", resultUnitId: "unit-sex", resultUnit: { name: "Sexmästeriet" } };

describe("assign", () => {
  it("gives an inkorg invoice to a unit and mails its resultatansvarig", async () => {
    h.capabilities = ["INVOICE_TRIAGE"];
    const res = await call({ action: "assign", resultUnitId: "unit-sex" });
    expect(res.status).toBe(200);
    expect(h.invoiceUpdate).toHaveBeenCalledWith({
      where: { id: "inv1", status: "INBOX" },
      data: expect.objectContaining({ status: "ASSIGNED", resultUnitId: "unit-sex", assignedById: "actor" }),
    });
    expect(h.notify.mock.calls[0][1]).toBe("SUPPLIER_INVOICE_ASSIGNED");
  });

  it("is triage's alone", async () => {
    h.capabilities = ["BOOKKEEPING"];
    expect((await call({ action: "assign", resultUnitId: "unit-sex" })).status).toBe(403);
  });

  it("answers 409 when somebody moved it first", async () => {
    h.capabilities = ["INVOICE_TRIAGE"];
    h.invoiceUpdate.mockResolvedValue({ count: 0 });
    expect((await call({ action: "assign", resultUnitId: "unit-sex" })).status).toBe(409);
    expect(h.notify).not.toHaveBeenCalled();
  });
});

describe("attest, as the kontering", () => {
  beforeEach(() => {
    asSexmastare();
    h.invoice = assigned;
  });

  it("konterar and attests in one step, the whole invoice on one cost centre", async () => {
    const res = await call({ action: "attest", rows: [{ costCenterCode: "sex01" }] });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("APPROVED");
    const created = h.allocationCreate.mock.calls[0][0].data;
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ costCenterId: "cc-0-SEX01", amount: null, approvedById: "actor" });
    expect(h.invoiceUpdate).toHaveBeenCalledWith({
      where: { id: "inv1", status: "ASSIGNED" },
      data: { status: "APPROVED" },
    });
    expect(h.event.mock.calls.map((c) => c[0].data.type)).toEqual(["COST_CENTER_APPROVED", "APPROVED"]);
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("signs its own share of a split and asks the other unit for the rest", async () => {
    h.attesters = ["cafe-chief"];
    const res = await call({
      action: "attest",
      rows: [
        { costCenterCode: "SEX01", amount: 80000 },
        { costCenterCode: "CAFE01", amount: 45000 },
      ],
    });
    expect((await res.json()).status).toBe("PENDING_APPROVAL");
    const created = h.allocationCreate.mock.calls[0][0].data;
    expect(created.map((r: { approvedById: string | null }) => r.approvedById)).toEqual(["actor", null]);
    expect(h.notify).toHaveBeenCalledWith(
      expect.anything(),
      "SUPPLIER_INVOICE_SUBMITTED",
      ["cafe-chief"],
      expect.anything(),
      { exclude: ["actor"] },
    );
  });

  it("refuses a split without every share", async () => {
    const res = await call({
      action: "attest",
      rows: [{ costCenterCode: "SEX01", amount: 80000 }, { costCenterCode: "SEX02" }],
    });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("supplierInvoice.splitNeedsAmounts");
    expect(h.invoiceUpdate).not.toHaveBeenCalled();
  });

  it("refuses an invoice without its PDF", async () => {
    h.invoice = { ...assigned, _count: { documents: 0 } };
    const res = await call({ action: "attest", rows: [{ costCenterCode: "SEX01" }] });
    expect((await res.json()).error).toBe("supplierInvoice.noDocument");
  });

  it("is not another unit's to attest", async () => {
    h.ownedUnits = [];
    expect((await call({ action: "attest", rows: [{ costCenterCode: "SEX01" }] })).status).toBe(403);
  });
});

describe("attest, another unit's share", () => {
  it("signs only the viewer's unsigned rows, and finishes on the last", async () => {
    h.roles = ["RESULTATANSVARIG"];
    h.capabilities = ["ATTEST_VIEW"];
    h.ownedUnits = ["Caféutskottet"];
    h.invoice = { ...assigned, status: "PENDING_APPROVAL" };
    h.allocations = [
      row({ id: "a1", approvedById: "klara", amount: 80000 }),
      row({ id: "a2", amount: 45000, costCenter: { code: "CAFE01", name: "Caféet" } }),
    ];
    const res = await call({ action: "attest" });
    expect((await res.json()).status).toBe("APPROVED");
    expect(h.allocationUpdate).toHaveBeenCalledWith({
      where: { id: { in: ["a2"] }, approvedById: null },
      data: expect.objectContaining({ approvedById: "actor" }),
    });
    expect(h.allocationCreate).not.toHaveBeenCalled();
  });
});

describe("decline", () => {
  it("sends it back to the inkorg, with a comment", async () => {
    asSexmastare();
    h.invoice = assigned;
    expect((await call({ action: "decline" })).status).toBe(422);
    const res = await call({ action: "decline", comment: "Det här är Caféets" });
    expect((await res.json()).status).toBe("INBOX");
    expect(h.invoiceUpdate.mock.calls[0][0].data).toMatchObject({ status: "INBOX", resultUnitId: null });
    expect(h.event.mock.calls[0][0].data).toMatchObject({ type: "DECLINED", comment: "Det här är Caféets" });
  });
});

describe("withdraw_attest", () => {
  it("takes the signer's own signature off and puts it back to waiting", async () => {
    asSexmastare();
    h.invoice = { ...assigned, status: "APPROVED" };
    h.allocations = [row({ approvedById: "actor" })];
    const res = await call({ action: "withdraw_attest" });
    expect((await res.json()).status).toBe("ASSIGNED");
    expect(h.allocationUpdate).toHaveBeenCalledWith({
      where: { id: { in: ["a1"] }, approvedById: "actor" },
      data: { approvedById: null, approvedAt: null },
    });
  });
});

describe("request_changes", () => {
  it("needs a comment, and is the treasury's once attested", async () => {
    h.capabilities = ["BOOKKEEPING"];
    h.invoice = { ...assigned, status: "APPROVED" };
    h.allocations = [row({ approvedById: "klara" })];
    expect((await call({ action: "request_changes" })).status).toBe(422);
    const res = await call({ action: "request_changes", comment: "Fel kostnadsställe" });
    expect((await res.json()).status).toBe("CHANGES_REQUESTED");

    h.capabilities = ["BOOKKEEPING_VIEW"];
    expect((await call({ action: "request_changes", comment: "x" })).status).toBe(403);
  });
});
