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
  lines: [] as { account: string; debit: number; credit: number }[],
  lineDelete: vi.fn(),
  remaining: 0,
  invoiceUpdate: vi.fn(),
  allocationUpdate: vi.fn(),
  allocationDelete: vi.fn(),
  allocationCreate: vi.fn(),
  event: vi.fn(),
  notify: vi.fn(),
  attesters: [] as string[],
  reading: { fields: {}, supplier: null } as { fields: Record<string, unknown>; supplier: null },
}));

vi.mock("@/lib/server/invoice-documents", () => ({ readInvoiceScan: async () => h.reading }));

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
        status: "ASSIGNED",
        resultUnitId: "unit-cafe",
        resultUnit: { name: "Caféutskottet" },
        supplierName: null,
        invoiceNumber: null,
        description: "Släp",
        amount: null,
        dueDate: null,
        prefilled: [],
        rounding: null,
        lines: h.lines,
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
        supplierInvoiceLine: { deleteMany: h.lineDelete },
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
  h.lines = [];
  h.remaining = 0;
  h.attesters = [];
  h.reading = { fields: {}, supplier: null };
  for (const fn of [h.invoiceUpdate, h.allocationUpdate, h.allocationDelete, h.allocationCreate, h.lineDelete, h.event, h.notify]) {
    fn.mockReset();
    fn.mockResolvedValue({ count: 1 });
  }
});

const assigned = { status: "ASSIGNED", resultUnitId: "unit-sex", resultUnit: { name: "Sexmästeriet" } };

describe("assign, to another unit", () => {
  it("moves it and mails the new unit's resultatansvarig, keeping where it was", async () => {
    h.capabilities = ["INVOICE_TRIAGE"];
    const res = await call({ action: "assign", resultUnitId: "unit-sex" });
    expect(res.status).toBe(200);
    expect(h.invoiceUpdate).toHaveBeenCalledWith({
      where: { id: "inv1", status: "ASSIGNED" },
      data: expect.objectContaining({ status: "ASSIGNED", resultUnitId: "unit-sex", assignedById: "actor" }),
    });
    expect(h.event.mock.calls[0][0].data.diff).toEqual({ from: "Caféutskottet", to: "Sexmästeriet" });
    expect(h.notify.mock.calls[0][1]).toBe("SUPPLIER_INVOICE_ASSIGNED");
  });

  it("needs a unit to move it to", async () => {
    h.capabilities = ["INVOICE_TRIAGE"];
    expect((await call({ action: "assign" })).status).toBe(422);
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

describe("attest, as the fördelning", () => {
  beforeEach(() => {
    asSexmastare();
    h.invoice = assigned;
  });

  // What the unit read off the invoice, sent with every fördelning.
  const read = { amount: 125000, dueDate: "2026-11-30" };

  it("fördelar and attests in one step, the whole invoice on one cost centre", async () => {
    const res = await call({ action: "attest", rows: [{ costCenterCode: "sex01" }], ...read, description: "Släp" });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("APPROVED");
    const created = h.allocationCreate.mock.calls[0][0].data;
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ costCenterId: "cc-0-SEX01", amount: null, approvedById: "actor" });
    expect(h.invoiceUpdate).toHaveBeenCalledWith({
      where: { id: "inv1", status: "ASSIGNED" },
      data: {
        status: "APPROVED",
        amount: 125000,
        dueDate: new Date("2026-11-30T00:00:00.000Z"),
        description: "Släp",
        prefilled: [],
      },
    });
    expect(h.event.mock.calls.map((c) => c[0].data.type)).toEqual(["COST_CENTER_APPROVED", "APPROVED"]);
    // A kontering made from an earlier split goes with it.
    expect(h.lineDelete).toHaveBeenCalledWith({ where: { invoiceId: "inv1" } });
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("needs the amount and the due date", async () => {
    const rows = [{ costCenterCode: "SEX01" }];
    expect((await (await call({ action: "attest", rows, dueDate: read.dueDate })).json()).error).toBe(
      "supplierInvoice.noAmount",
    );
    expect((await (await call({ action: "attest", rows, amount: read.amount })).json()).error).toBe(
      "supplierInvoice.noDueDate",
    );
    expect(h.invoiceUpdate).not.toHaveBeenCalled();
  });

  it("signs its own share of a split and asks the other unit for the rest", async () => {
    h.attesters = ["cafe-chief"];
    const res = await call({
      ...read,
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

  it("splits against the amount the unit read, and fills the rest from the PDF", async () => {
    h.invoice = { ...h.invoice, amount: 100000, prefilled: ["amount", "dueDate"] };
    h.reading = { fields: { amount: 99900, invoiceNumber: "20417" }, supplier: null };
    const rows = [
      { costCenterCode: "SEX01", amount: 80000 },
      { costCenterCode: "SEX02", amount: 45000 },
    ];
    // Against the 1 000 kr already on it the rows are too much; against 1 250 they meet.
    expect((await call({ action: "attest", rows, dueDate: read.dueDate })).status).toBe(422);
    const res = await call({ action: "attest", rows, ...read });
    expect(res.status).toBe(200);
    expect(h.invoiceUpdate).toHaveBeenCalledWith({
      where: { id: "inv1", status: "ASSIGNED" },
      data: {
        status: "APPROVED",
        amount: 125000,
        dueDate: new Date("2026-11-30T00:00:00.000Z"),
        invoiceNumber: "20417",
        // What the unit typed is theirs; what was only read stays marked.
        prefilled: ["invoiceNumber"],
      },
    });
  });

  it("refuses a split without every share", async () => {
    const res = await call({
      ...read,
      action: "attest",
      rows: [{ costCenterCode: "SEX01", amount: 80000 }, { costCenterCode: "SEX02" }],
    });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("supplierInvoice.splitNeedsAmounts");
    expect(h.invoiceUpdate).not.toHaveBeenCalled();
  });

  it("refuses an invoice without its PDF", async () => {
    h.invoice = { ...assigned, _count: { documents: 0 } };
    const res = await call({ action: "attest", rows: [{ costCenterCode: "SEX01" }], ...read });
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

describe("book, the treasury's kontering", () => {
  const complete = {
    ...assigned,
    status: "APPROVED",
    fortnoxSupplierNumber: "12",
    invoiceNumber: "20417",
    invoiceDate: new Date("2026-10-20"),
    dueDate: new Date("2026-11-30"),
    amount: 125000,
  };

  it("marks a complete kontering konterad, and nothing goes to Fortnox", async () => {
    h.capabilities = ["BOOKKEEPING"];
    h.invoice = complete;
    h.allocations = [row({ approvedById: "klara" })];
    h.lines = [{ account: "5615", debit: 125000, credit: 0 }];
    const res = await call({ action: "book" });
    expect((await res.json()).status).toBe("BOOKED");
    expect(h.invoiceUpdate).toHaveBeenCalledWith({
      where: { id: "inv1", status: "APPROVED" },
      data: { status: "BOOKED" },
    });
    expect(h.event.mock.calls.map((c) => c[0].data.type)).toEqual(["BOOKED"]);
  });

  it("refuses one that is not enough to send yet", async () => {
    h.capabilities = ["BOOKKEEPING"];
    h.invoice = complete;
    h.allocations = [row({ approvedById: "klara" })];
    h.lines = [{ account: "5615", debit: 120000, credit: 0 }];
    expect((await (await call({ action: "book" })).json()).error).toBe("supplierInvoice.unbalanced");
    expect(h.invoiceUpdate).not.toHaveBeenCalled();
  });

  it("is the bookkeepers', and only once it is attested", async () => {
    h.capabilities = ["INVOICE_TRIAGE"];
    h.invoice = complete;
    expect((await call({ action: "book" })).status).toBe(403);
    h.capabilities = ["BOOKKEEPING"];
    h.invoice = { ...complete, status: "PENDING_APPROVAL" };
    expect((await call({ action: "book" })).status).toBe(409);
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

describe("redistribute", () => {
  const split = () => [
    row({ id: "a1", approvedById: "actor", amount: 80000 }),
    row({ id: "a2", amount: 45000, costCenter: { code: "CAFE01", name: "Caféet" } }),
  ];

  it("takes every signature off and gives the split back to the unit", async () => {
    asSexmastare();
    h.invoice = { ...assigned, status: "PENDING_APPROVAL" };
    h.allocations = split();
    const res = await call({ action: "redistribute" });
    expect((await res.json()).status).toBe("ASSIGNED");
    expect(h.allocationUpdate).toHaveBeenCalledWith({
      where: { invoiceId: "inv1" },
      data: { approvedById: null, approvedAt: null },
    });
  });

  it("is the proposing unit's, not the unit asked to sign", async () => {
    h.roles = ["RESULTATANSVARIG"];
    h.capabilities = ["ATTEST_VIEW"];
    h.ownedUnits = ["Caféutskottet"];
    h.invoice = { ...assigned, status: "PENDING_APPROVAL" };
    h.allocations = split();
    expect((await call({ action: "redistribute" })).status).toBe(403);
    expect(h.allocationUpdate).not.toHaveBeenCalled();
  });
});
