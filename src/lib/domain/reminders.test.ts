import { describe, expect, it } from "vitest";
import { canRemindAboutTransaction, reminderTarget } from "./reminders";

describe("reminderTarget", () => {
  it("asks the attesters about an utlägg waiting for attest", () => {
    expect(reminderTarget("PENDING_APPROVAL")).toBe("attesters");
  });

  it("asks the submitter about one still in their hands", () => {
    expect(reminderTarget("DRAFT")).toBe("submitter");
    expect(reminderTarget("CHANGES_REQUESTED")).toBe("submitter");
  });

  it("asks nobody once it is signed", () => {
    expect(reminderTarget("APPROVED")).toBeNull();
    expect(reminderTarget("BOOKED")).toBeNull();
    expect(reminderTarget("EXPORTED")).toBeNull();
  });
});

describe("canRemindAboutTransaction", () => {
  it("offers a purchase on somebody else's card with no utlägg", () => {
    expect(canRemindAboutTransaction({ cardHolderId: "maja" }, "me")).toBe(true);
  });

  it("not one already accounted for", () => {
    expect(canRemindAboutTransaction({ cardHolderId: "maja", matchedExpenseId: "e1" }, "me")).toBe(false);
  });

  it("not one on no card, or on the viewer's own", () => {
    expect(canRemindAboutTransaction({}, "me")).toBe(false);
    expect(canRemindAboutTransaction({ cardHolderId: "me" }, "me")).toBe(false);
  });
});
