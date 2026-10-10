import { afterEach, describe, expect, it, vi } from "vitest";
import { claimReference } from "./expense-reference";

// The year turning over, against a stand-in for the one query claimReference
// makes. What is checked is which year it asks about and what it hands out.
//
// On UTC, like the production host. A developer's machine is usually on
// Swedish time, where the bug this guards against cannot happen and the
// midnight test below would pass either way.
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
    // 23:30 UTC on New Year's Eve is 00:30 on 1 January in Stockholm. The
    // server's own clock still says 2026; the section's calendar does not.
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
