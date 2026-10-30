import { beforeEach, describe, expect, it, vi } from "vitest";

// Exporting a levfaktura to Fortnox, where the one thing that must never
// happen is a supplier invoice made twice.
//
// Fortnox is mocked; the lock, the order of the steps and what is written at
// each are the real ones. The rule under test: the lock is let go only when it
// is certain nothing was made, and kept, UNCERTAIN, when it is not.

const h = vi.hoisted(() => ({
  invoice: {} as Record<string, unknown>,
  claimCount: 1,
  updates: [] as { where: unknown; data: Record<string, unknown> }[],
  events: [] as unknown[],
  create: vi.fn(),
  connect: vi.fn(),
  supplier: { number: "12", name: "Lunds Släp AB", orgNo: null, bankgiro: "5050-1055", plusgiro: null, active: true },
}));

vi.mock("@/lib/server/current-user", () => ({
  resolveUserId: async () => "maja",
  loadUser: async () => ({
    name: "Maja Holm",
    email: "m@dsek.se",
    studentId: "ma1234ho-s",
    roles: ["SKATTMASTARE"],
    capabilities: ["BOOKKEEPING", "INVOICE_TRIAGE", "FORTNOX_LOGIN"],
  }),
}));

vi.mock("@/lib/server/db", () => {
  const updateMany = async (args: { where: unknown; data: Record<string, unknown> }) => {
    h.updates.push(args);
    // The first update is the claim; the rest are the lock moving on.
    return { count: h.updates.length === 1 ? h.claimCount : 1 };
  };
  return {
    prisma: {
      supplierInvoice: {
        findFirst: async () => ({
          id: "inv1",
          status: "BOOKED",
          resultUnitId: "unit-sex",
          resultUnit: { name: "Sexmästeriet" },
          supplierName: "Lunds Släp AB",
          fortnoxSupplierNumber: "12",
          invoiceNumber: "20417",
          invoiceDate: new Date("2026-10-20"),
          dueDate: new Date("2026-11-10"),
          amount: 125000,
          ocr: "123456789012",
          bankgiro: "5050-1055",
          plusgiro: null,
          yourReference: "SEX01",
          description: "Släp till nollningen",
          exportClaimState: null,
          exportClaimedAt: null,
          _count: { documents: 1 },
          allocations: [
            {
              id: "a1",
              approvedById: "klara",
              approvedAt: new Date("2026-10-27T10:00:00Z"),
              amount: null,
              account: "5615",
              project: null,
              comment: null,
              costCenter: { code: "SEX01", name: "Sexmästeriet" },
            },
          ],
          lines: [
            {
              account: "5615",
              costCenterCode: "SEX01",
              project: null,
              description: "Släp",
              debit: 125000,
              credit: 0,
            },
          ],
          rounding: null,
          ...h.invoice,
        }),
        updateMany,
      },
      supplierInvoiceDocument: {
        findMany: async () => [{ objectKey: "k", mimeType: "application/pdf" }],
      },
      user: { findMany: async () => [{ id: "klara", name: "Klara Ström" }] },
      resultUnit: { findMany: async () => [] },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({ supplierInvoice: { updateMany }, supplierInvoiceEvent: { create: async (a: unknown) => h.events.push(a) } }),
    },
  };
});

vi.mock("@/lib/server/result-units", () => ({
  ownedResultUnits: async () => ({ names: [], prefixes: [] }),
  getPrefixes: async () => [],
  resultUnitNameForCode: () => null,
  costCentreWhereForPrefixes: () => ({}),
}));

vi.mock("@/lib/server/storage", () => ({
  getObjectBuffer: async () => ({ bytes: Buffer.from("%PDF-1.4"), contentType: "application/pdf" }),
}));
vi.mock("@/lib/server/pdf-merge", () => ({
  mergeCoverAndReceipts: async () => ({ bytes: new Uint8Array([1, 2, 3]), failed: 0 }),
}));
vi.mock("@/lib/server/invoice-cover", () => ({ renderInvoiceCover: async () => new Uint8Array([1]) }));
vi.mock("@/lib/fortnox/export", () => ({ userToken: async () => ({ ok: true, token: "t" }) }));

vi.mock("@/lib/fortnox", () => {
  class FortnoxError extends Error {
    constructor(
      message: string,
      readonly status?: number,
    ) {
      super(message);
    }
  }
  return {
    FortnoxError,
    // The register is read as the organisation; only the writes are Maja's.
    getServiceToken: async () => "service-token",
    getSupplier: async () => h.supplier,
    uploadInboxFile: async () => "file-1",
    createSupplierInvoice: h.create,
    connectFileToSupplierInvoice: h.connect,
  };
});

const { POST } = await import("./route");
const { FortnoxError } = (await import("@/lib/fortnox")) as unknown as {
  FortnoxError: new (m: string, s?: number) => Error;
};

const call = (body: object = {}) =>
  POST(
    new Request("http://test/api/supplier-invoices/inv1/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "inv1" }) },
  );

const states = () => h.updates.map((u) => u.data.exportClaimState ?? (u.data.status === "EXPORTED" ? "DONE" : null));

beforeEach(() => {
  h.invoice = {};
  h.claimCount = 1;
  h.updates = [];
  h.events = [];
  h.create.mockReset();
  h.connect.mockReset();
  h.create.mockResolvedValue("4711");
  h.connect.mockResolvedValue(undefined);
  h.supplier = { ...h.supplier, bankgiro: "5050-1055" };
});

describe("export", () => {
  it("makes the supplier invoice with the attested kontering, and records it", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "EXPORTED", givenNumber: "4711", attachFailed: null });
    expect(h.create.mock.calls[0][1]).toMatchObject({
      supplierNumber: "12",
      invoiceNumber: "20417",
      invoiceDate: "2026-10-20",
      dueDate: "2026-11-10",
      total: 1250,
      payableAccount: 2440,
      rows: [{ account: 5615, debit: 1250, credit: 0, costCenter: "SEX01", text: "Släp" }],
    });
    expect(states()).toEqual(["CLAIMED", "SENT", "DONE"]);
    expect(h.connect).toHaveBeenCalledWith("t", "file-1", "4711");
  });

  it("refuses a second press while the first holds the lock", async () => {
    h.claimCount = 0;
    const res = await call();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("supplierInvoice.exportInProgress");
    expect(h.create).not.toHaveBeenCalled();
  });

  it("lets the lock go when Fortnox refused outright, so it can be tried again", async () => {
    h.create.mockRejectedValue(new FortnoxError("Kontot finns inte", 400));
    const res = await call();
    expect(res.status).toBe(400);
    expect(h.updates.at(-1)!.data).toEqual({ exportClaimedAt: null, exportClaimedById: null, exportClaimState: null });
  });

  it("keeps the lock, uncertain, when Fortnox did not answer", async () => {
    h.create.mockRejectedValue(new Error("The operation was aborted due to timeout"));
    const res = await call();
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("supplierInvoice.exportUncertain");
    expect(states().at(-1)).toBe("UNCERTAIN");
  });

  it("keeps the lock, uncertain, on a Fortnox server error too", async () => {
    h.create.mockRejectedValue(new FortnoxError("Internal error", 503));
    await call();
    expect(states().at(-1)).toBe("UNCERTAIN");
  });

  it("stops at a bankgiro the register does not have, before taking the lock", async () => {
    h.supplier = { ...h.supplier, bankgiro: "999-9999" };
    const res = await call();
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "supplierInvoice.giroMismatch", giroMismatch: true });
    expect(h.updates).toHaveLength(0);
    expect((await call({ confirmGiro: true })).status).toBe(200);
  });

  it("is still exported when only attaching the PDF failed", async () => {
    h.connect.mockRejectedValue(new Error("connect failed"));
    const res = await call();
    expect(await res.json()).toMatchObject({ status: "EXPORTED", attachFailed: "connect failed" });
  });

  it("refuses an invoice that is not complete", async () => {
    h.invoice = { invoiceNumber: null };
    const res = await call();
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("supplierInvoice.noInvoiceNumber");
  });
});
