import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  year: null as { id: number; fromDate: string; toDate: string } | null,
}));

vi.mock("server-only", () => ({}));
// guard.ts, for `fail`, reaches the session through this.
vi.mock("@/lib/server/current-user", () => ({}));
vi.mock("@/lib/server/fiscal-year", () => ({ getFiscalYear: async () => h.year }));

import { denyBudgetOutsideFiscalYear, denyOutsideFiscalYear } from "./fiscal-year";

beforeEach(() => {
  h.year = { id: 1, fromDate: "2026-01-01", toDate: "2026-12-31" };
});

describe("denyOutsideFiscalYear", () => {
  it("lets a date in the picked year through", async () => {
    expect(await denyOutsideFiscalYear("2026-03-19")).toBeNull();
    expect(await denyOutsideFiscalYear(new Date("2026-12-31T00:00:00.000Z"))).toBeNull();
  });

  it("refuses one outside it, naming the year", async () => {
    const res = await denyOutsideFiscalYear("2025-12-31");
    expect(res?.status).toBe(422);
    expect(await res?.json()).toEqual({ error: "fiscalYear.outside", errorValues: { year: "2026" } });
  });

  it("has nothing to say about no date, or before any year is synced", async () => {
    expect(await denyOutsideFiscalYear(null)).toBeNull();
    h.year = null;
    expect(await denyOutsideFiscalYear("2019-01-01")).toBeNull();
  });
});

describe("denyBudgetOutsideFiscalYear", () => {
  it("keeps a budget to the year the picked one starts in", async () => {
    expect(await denyBudgetOutsideFiscalYear(2026)).toBeNull();
    expect((await denyBudgetOutsideFiscalYear(2025))?.status).toBe(422);
  });
});
