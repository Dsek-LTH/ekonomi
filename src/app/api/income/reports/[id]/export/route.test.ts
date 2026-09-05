import { beforeEach, describe, expect, it, vi } from "vitest";

// Filing a day's takings in Fortnox.
//
// Deliberately the same shape as api/expenses/[id]/export, and since the shared
// half moved to lib/fortnox/export.ts what is left here is what actually
// differs, which is what this pins:
//
//   the series        takings have a verifikationsserie of their own, falling
//                     back to the connection's
//   the duplicate     the last check before anything is written over there,
//                     against the day as it stands *now* rather than as it
//                     stood at import, and before the upload so that a refusal
//                     leaves nothing behind at all
//   the document      already rendered, so unlike an utlägg there is no cover
//                     to draw here
//
// The ordering rule itself (attachment first, voucher second) is pinned in the
// expense export's test; the two go through the same helpers.

const h = vi.hoisted(() => ({
  capabilities: ["BOOKKEEPING"] as string[],
  status: "BOOKED" as string,
  documentKey: "doc/1" as string | null,
  incomeVoucherSeries: null as string | null,
  /** What Fortnox already has for the day, keyed as `incomeVoucherKey` does. */
  existing: new Map<string, string>(),
  calls: [] as string[],
  createVoucher: vi.fn(),
  uploadInboxFile: vi.fn(),
  connectFile: vi.fn(),
  verificationUpdate: vi.fn(),
  reportUpdate: vi.fn(),
}));

vi.mock("@/lib/server/current-user", () => ({
  resolveUserId: async () => "bookkeeper",
  loadUser: async () => ({
    name: "Skattmästare",
    email: "s@dsek.se",
    studentId: "sk1234tm-s",
    roles: ["SKATTMASTARE"],
    capabilities: h.capabilities,
  }),
}));

vi.mock("@/lib/server/db", () => ({
  prisma: {
    incomeReport: {
      findUnique: async () => ({
        id: "r1",
        status: h.status,
        documentKey: h.documentKey,
        documentFilename: "intaktsrakning.pdf",
        verification: {
          id: "v1",
          date: new Date("2026-03-01"),
          description: "Källaren 2026-03-01",
          lines: [
            {
              account: "3001",
              debit: 0,
              credit: 125000,
              description: null,
              costCenter: { code: "KAL01", source: "FORTNOX" },
            },
          ],
        },
      }),
    },
    bookkeepingSettings: {
      findUnique: async () => ({ incomeVoucherSeries: h.incomeVoucherSeries }),
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        verification: { update: h.verificationUpdate },
        incomeReport: { update: h.reportUpdate },
      }),
  },
}));

class FortnoxError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

vi.mock("@/lib/fortnox", () => ({
  getConnection: async () => ({ voucherSeries: "A" }),
  getUserToken: async () => "tok",
  createVoucher: (...a: unknown[]) => {
    h.calls.push("createVoucher");
    return h.createVoucher(...a);
  },
  uploadInboxFile: (...a: unknown[]) => {
    h.calls.push("uploadInboxFile");
    return h.uploadInboxFile(...a);
  },
  connectFileToVoucher: (...a: unknown[]) => {
    h.calls.push("connectFileToVoucher");
    return h.connectFile(...a);
  },
  FortnoxAuthRequiredError: class extends Error {},
  FortnoxError,
}));

vi.mock("@/lib/income/duplicate", () => ({
  fortnoxIncomeVouchers: async () => {
    h.calls.push("fortnoxIncomeVouchers");
    return { byKey: h.existing };
  },
  incomeVoucherKey: (date: string, description: string) => `${date}|${description}`,
}));

vi.mock("@/lib/server/storage", () => ({
  getObjectBuffer: async () => ({ bytes: new Uint8Array([1, 2, 3]) }),
}));

const { POST } = await import("./route");

const exportIt = () =>
  POST(new Request("http://test/api/income/reports/r1/export", { method: "POST" }), {
    params: Promise.resolve({ id: "r1" }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  h.calls = [];
  h.capabilities = ["BOOKKEEPING"];
  h.status = "BOOKED";
  h.documentKey = "doc/1";
  h.incomeVoucherSeries = null;
  h.existing = new Map();
  h.uploadInboxFile.mockResolvedValue("file-1");
  h.createVoucher.mockResolvedValue({ series: "B", number: 7, year: 10 });
  h.connectFile.mockResolvedValue(undefined);
  h.verificationUpdate.mockResolvedValue({});
  h.reportUpdate.mockResolvedValue({});
});

describe("POST /api/income/reports/[id]/export", () => {
  it("refuses anybody who is not a bookkeeper", async () => {
    h.capabilities = [];
    expect((await exportIt()).status).toBe(403);
    expect(h.calls).toEqual([]);
  });

  it("refuses a report that has not been booked", async () => {
    for (const status of ["DRAFT", "EXPORTED"]) {
      h.status = status;
      const res = await exportIt();
      expect(res.status).toBe(409);
      await expect(res.json()).resolves.toMatchObject({ error: "income.exportOnlyBooked" });
    }
    expect(h.calls).toEqual([]);
  });

  it("files under the takings' own series when one is set", async () => {
    h.incomeVoucherSeries = "B";
    await exportIt();
    expect(h.createVoucher.mock.calls[0][1]).toMatchObject({ series: "B" });
  });

  it("falls back to the connection's series when none is set", async () => {
    await exportIt();
    expect(h.createVoucher.mock.calls[0][1]).toMatchObject({ series: "A" });
  });

  it("checks for a duplicate before it uploads anything", async () => {
    // A refusal has to leave nothing behind at all, which is only true while
    // the check runs ahead of the upload.
    await exportIt();
    expect(h.calls[0]).toBe("fortnoxIncomeVouchers");
    expect(h.calls).toEqual([
      "fortnoxIncomeVouchers",
      "uploadInboxFile",
      "createVoucher",
      "connectFileToVoucher",
    ]);
  });

  it("refuses a day Fortnox already has, and writes nothing", async () => {
    h.existing = new Map([["2026-03-01|Källaren 2026-03-01", "B-3"]]);
    const res = await exportIt();
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ error: "income.alreadyInFortnox" });
    // Nothing uploaded, nothing created, nothing flipped.
    expect(h.calls).toEqual(["fortnoxIncomeVouchers"]);
    expect(h.reportUpdate).not.toHaveBeenCalled();
  });

  it("records the voucher and flips the report", async () => {
    const res = await exportIt();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ label: "B-7" });
    expect(h.verificationUpdate).toHaveBeenCalledWith({
      where: { id: "v1" },
      data: expect.objectContaining({ fortnoxSeries: "B", fortnoxNumber: 7 }),
    });
    expect(h.reportUpdate).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: { status: "EXPORTED" },
    });
  });

  it("sends öre as decimal SEK", async () => {
    await exportIt();
    expect(h.createVoucher.mock.calls[0][1].rows).toEqual([
      { account: 3001, debit: 0, credit: 1250, costCenter: "KAL01", description: undefined },
    ]);
  });

  it("writes nothing locally when Fortnox refuses the voucher", async () => {
    h.createVoucher.mockRejectedValue(new FortnoxError("Serien är låst", 400));
    const res = await exportIt();
    expect(res.status).toBe(400);
    expect(h.reportUpdate).not.toHaveBeenCalled();
  });
});
