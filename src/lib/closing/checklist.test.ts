import { describe, expect, it } from "vitest";
import { dueDateFor, isItemDone } from "./checklist";

describe("dueDateFor", () => {
  it("counts from the year's last day, either way", () => {
    expect(dueDateFor("2026-12-31", 14)).toBe("2027-01-14");
    expect(dueDateFor("2026-12-31", -21)).toBe("2026-12-10");
    expect(dueDateFor("2026-12-31", 0)).toBe("2026-12-31");
  });

  it("has no due date without an offset", () => {
    expect(dueDateFor("2026-12-31", null)).toBeNull();
  });
});

describe("isItemDone", () => {
  it("goes by the check where there is one, whatever was ticked", () => {
    const left = { remaining: 3, href: "/bookkeeping" };
    expect(isItemDone({ doneAt: "2027-01-02T10:00:00Z", check: left })).toBe(false);
    expect(isItemDone({ doneAt: null, check: { remaining: 0, href: null } })).toBe(true);
  });

  it("goes by the tick otherwise", () => {
    expect(isItemDone({ doneAt: null, check: null })).toBe(false);
    expect(isItemDone({ doneAt: "2027-01-02T10:00:00Z", check: null })).toBe(true);
  });
});
