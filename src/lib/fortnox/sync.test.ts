import { beforeEach, describe, expect, it, vi } from "vitest";

// The nightly sync (syncAll): one claim at a time, each step on its own, and
// this year's and last year's ledger.
//
// Fortnox and the database are mocked. What is real is the order of the steps,
// which ones are skipped when another fails, and what is recorded afterwards.

const h = vi.hoisted(() => ({
  claim: 1,
  sie: [] as number[],
  finished: [] as Record<string, unknown>[],
  costCentersFail: false,
  yearsFail: false,
  years: [] as { id: number; fromDate: string; toDate: string }[],
}));

const YEARS = [
  { id: 3, fromDate: "2026-07-01", toDate: "2027-06-30" },
  { id: 2, fromDate: "2025-07-01", toDate: "2026-06-30" },
  { id: 1, fromDate: "2024-07-01", toDate: "2025-06-30" },
];

// Every model method answers with nothing to do, which is all the steps need
// to run to the end. Only the claim and the record of the run are looked at.
vi.mock("@/lib/server/db", () => {
  const model = new Proxy(
    {},
    {
      get: (_t, method) =>
        method === "findMany"
          ? async () => []
          : async (args: { data?: Record<string, unknown> }) => {
              if (method === "update" && args?.data && "lastFinishedAt" in args.data) h.finished.push(args.data);
              return { count: 0 };
            },
    },
  );
  const prisma: Record<string, unknown> = new Proxy(
    {
      $executeRaw: async () => h.claim,
      $executeRawUnsafe: async () => 0,
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
    },
    { get: (t, key: string) => (key in t ? t[key as keyof typeof t] : model) },
  );
  return { prisma };
});

vi.mock("@/lib/generated/prisma/client", () => ({ Prisma: { DbNull: "DbNull" } }));
vi.mock("@/lib/server/supplier-register", () => ({ rememberRegister: async () => {} }));
vi.mock("@/lib/fortnox/sie", () => ({
  parseSie: () => ({
    vouchers: [],
    accounts: new Map(),
    costCenters: new Map(),
    openingBalances: new Map(),
    closingBalances: new Map(),
  }),
}));

vi.mock("@/lib/fortnox", () => ({
  getServiceToken: async () => "service-token",
  listFinancialYears: async () => {
    if (h.yearsFail) throw new Error("fortnox down");
    return h.years.map((y) => ({ ...y }));
  },
  listCostCenters: async () => {
    if (h.costCentersFail) throw new Error("fortnox.missingCostCenterScope");
    return [];
  },
  listProjects: async () => [],
  listAccounts: async () => [],
  listSuppliers: async () => [{ number: "1", name: "Lunds Släp AB" }],
  fetchSie: async (_token: string, fyId: number) => {
    h.sie.push(fyId);
    return "";
  },
}));

const { syncAll } = await import("./sync");

beforeEach(() => {
  h.claim = 1;
  h.sie = [];
  h.finished = [];
  h.costCentersFail = false;
  h.yearsFail = false;
  h.years = YEARS.map((y) => ({ ...y }));
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-06T04:00:00Z"));
});

describe("syncAll", () => {
  it("syncs this financial year's ledger and the one before it", async () => {
    const result = await syncAll();
    expect(h.sie).toEqual([3, 2]);
    expect(result?.ledger.every((s) => s.ok)).toBe(true);
    expect(result?.suppliers).toEqual({ ok: true, result: { suppliers: 1 } });
    expect(h.finished).toEqual([expect.objectContaining({ runningSince: null, lastError: null })]);
  });

  it("stands aside while another sync holds the claim", async () => {
    h.claim = 0;
    expect(await syncAll()).toBeNull();
    expect(h.sie).toEqual([]);
    expect(h.finished).toEqual([]);
  });

  it("carries on past a step that fails, and records which one", async () => {
    h.costCentersFail = true;
    const result = await syncAll();
    expect(result?.costCenters).toEqual({ ok: false, error: "fortnox.missingCostCenterScope" });
    expect(result?.projects.ok).toBe(true);
    expect(h.sie).toEqual([3, 2]);
    expect(h.finished[0].lastError).toBe("costCenters: fortnox.missingCostCenterScope");
  });

  it("skips the accounts and the ledger without the financial years", async () => {
    h.yearsFail = true;
    const result = await syncAll();
    expect(result?.financialYears).toEqual({ ok: false, error: "fortnox down" });
    expect(result?.accounts.ok).toBe(false);
    expect(result?.suppliers.ok).toBe(true);
    expect(h.sie).toEqual([]);
  });

  it("takes only the current year when there is none before it", async () => {
    h.years = h.years.slice(0, 1);
    await syncAll();
    expect(h.sie).toEqual([3]);
  });
});
