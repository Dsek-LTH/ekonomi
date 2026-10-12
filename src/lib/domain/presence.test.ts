import { describe, expect, it } from "vitest";
import { HIDDEN_GRACE_MS, IDLE_MS, PRESENCE_TTL_MS, HEARTBEAT_MS, isIdle } from "./presence";

// When a bookkeeper stops counting as being on an utlägg. Getting this wrong
// one way leaves a name on a colleague's screen for somebody who went home;
// the other way makes a name blink in and out for somebody who is reading the
// receipt.

const T = 1_000_000_000;

describe("isIdle", () => {
  it("counts somebody who just did something as present", () => {
    expect(isIdle(T, T - 1_000, null)).toBe(false);
  });

  it("lets them go once they have done nothing for the idle period", () => {
    expect(isIdle(T, T - IDLE_MS + 1, null)).toBe(false);
    expect(isIdle(T, T - IDLE_MS, null)).toBe(true);
  });

  it("does not drop them for a quick look at another tab", () => {
    expect(isIdle(T, T, T - HIDDEN_GRACE_MS + 1)).toBe(false);
  });

  it("drops them once the tab has stayed hidden past the grace period", () => {
    // However recently they typed: a tab nobody can see is nobody's screen.
    expect(isIdle(T, T - 1, T - HIDDEN_GRACE_MS)).toBe(true);
  });
});

describe("the timings", () => {
  it("survive a missed heartbeat without dropping a live user", () => {
    expect(PRESENCE_TTL_MS).toBeGreaterThanOrEqual(2 * HEARTBEAT_MS);
  });
});
