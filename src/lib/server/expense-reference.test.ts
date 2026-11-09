import { afterEach, describe, expect, it, vi } from "vitest";
import { claimReference } from "./expense-reference";

// The year turning over, against a stand-in for the query claimReference makes. Runs on UTC like production.
process.env.TZ = "UTC";

function txWith(last: string | null) {
  const findFirst = vi.fn(async () => (last ? { reference: last } : null));
  return { findFirst, tx: { expense: { findFirst } } as never };
}

afterEach(() => vi.useRealTimers());

describe("claimReference", () => {
  it("starts 2027 at DEK27-0001, however far 2026 got", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2027-01-02T12:00:00Z"));
    const { tx, findFirst } = txWith(null);
    await expect(claimReference(tx)).resolves.toBe("DEK27-0001");
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { reference: { startsWith: "DEK27-" } } }),
    );
  });

  it("is already in the new year at half past midnight Swedish time", async () => {
    // 23:30 UTC on New Year's Eve is 00:30 on 1 January in Stockholm.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-12-31T23:30:00Z"));
    const { tx } = txWith(null);
    await expect(claimReference(tx)).resolves.toBe("DEK27-0001");
  });

  it("is still in the old year just before midnight Swedish time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-12-31T22:30:00Z"));
    const { tx } = txWith("DEK26-0812");
    await expect(claimReference(tx)).resolves.toBe("DEK26-0813");
  });
});
