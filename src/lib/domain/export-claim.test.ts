import { describe, expect, it } from "vitest";
import {
  CLAIM_ABANDONED_MS,
  FORTNOX_WRITE_TIMEOUT_MS,
  SEND_ABANDONED_MS,
  exportLock,
} from "./export-claim";

// A lock that never sent anything may lapse; one that sent a request never becomes "free", since something might exist in Fortnox.

const T = 1_000_000_000;
const at = (ago: number) => new Date(T - ago);

describe("exportLock", () => {
  it("is free when nobody has pressed Exportera", () => {
    expect(exportLock(null, null, T)).toBe("free");
  });

  it("is an export in progress while a fresh lock is held", () => {
    expect(exportLock("CLAIMED", at(1_000), T)).toBe("exporting");
    expect(exportLock("SENT", at(1_000), T)).toBe("exporting");
  });

  it("lets a lock that never sent anything lapse", () => {
    expect(exportLock("CLAIMED", at(CLAIM_ABANDONED_MS - 1), T)).toBe("exporting");
    expect(exportLock("CLAIMED", at(CLAIM_ABANDONED_MS), T)).toBe("free");
  });

  it("never lets a lock that sent a request lapse into free", () => {
    // Past the point no request can be in flight it needs a look, not a re-export.
    expect(exportLock("SENT", at(SEND_ABANDONED_MS - 1), T)).toBe("exporting");
    expect(exportLock("SENT", at(SEND_ABANDONED_MS), T)).toBe("uncertain");
    expect(exportLock("SENT", at(365 * 24 * 3_600_000), T)).toBe("uncertain");
  });

  it("keeps an uncertain lock uncertain until somebody resolves it", () => {
    expect(exportLock("UNCERTAIN", at(0), T)).toBe("uncertain");
    expect(exportLock("UNCERTAIN", at(365 * 24 * 3_600_000), T)).toBe("uncertain");
  });

  it("waits out the slowest request before calling one abandoned", () => {
    // Writes are called off at FORTNOX_WRITE_TIMEOUT_MS, so by then nothing can be in flight.
    expect(SEND_ABANDONED_MS).toBeGreaterThanOrEqual(5 * FORTNOX_WRITE_TIMEOUT_MS);
  });
});
