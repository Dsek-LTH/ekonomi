import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ row: null as Record<string, unknown> | null }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/db", () => ({
  prisma: { bookkeepingSettings: { findUnique: async () => h.row } },
}));

const { loadBookkeepingSettings } = await import("./bookkeeping-settings");

describe("loadBookkeepingSettings", () => {
  it("hands back what is stored", async () => {
    h.row = { bankAccount: "1930", memberDebtAccount: null };
    await expect(loadBookkeepingSettings()).resolves.toMatchObject({
      bankAccount: "1930",
      memberDebtAccount: null,
    });
  });

  it("makes nothing up when there is no row", async () => {
    h.row = null;
    const settings = await loadBookkeepingSettings();
    expect(Object.values(settings).every((v) => v === null)).toBe(true);
  });
});
