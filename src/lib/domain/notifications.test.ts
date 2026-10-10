import { describe, expect, it } from "vitest";
import { AUDIENCE, SWITCHABLE_KINDS, isOnByDefault, wants } from "./notifications";
import type { NotificationKind } from "./types";

const none = new Map<NotificationKind, boolean>();

describe("wants", () => {
  it("sends what asks the reader to act, and holds back what is only news", () => {
    expect(wants("EXPENSE_SUBMITTED", none)).toBe(true);
    expect(wants("EXPENSE_CHANGES_REQUESTED", none)).toBe(true);
    expect(wants("CARD_TRANSACTIONS_IMPORTED", none)).toBe(true);
    expect(wants("EXPENSE_COST_CENTER_APPROVED", none)).toBe(false);
    expect(wants("EXPENSE_EXPORTED", none)).toBe(false);
  });

  it("follows a saved choice either way", () => {
    expect(wants("EXPENSE_SUBMITTED", new Map([["EXPENSE_SUBMITTED", false]]))).toBe(false);
    expect(wants("EXPENSE_APPROVED", new Map([["EXPENSE_APPROVED", true]]))).toBe(true);
  });

  it("never lets a saved row silence the weekly digest", () => {
    expect(wants("WEEKLY_DIGEST", new Map([["WEEKLY_DIGEST", false]]))).toBe(true);
  });
});

describe("the switchable kinds", () => {
  it("leave out the digest, and only the digest", () => {
    const all = Object.keys(AUDIENCE) as NotificationKind[];
    expect(all.filter((k) => !SWITCHABLE_KINDS.includes(k))).toEqual(["WEEKLY_DIGEST"]);
  });

  it("list the defaults before the opt-ins", () => {
    const flags = SWITCHABLE_KINDS.map(isOnByDefault);
    expect(flags).toEqual([...flags].sort((a, b) => Number(b) - Number(a)));
  });
});
