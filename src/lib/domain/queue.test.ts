import { describe, expect, it } from "vitest";
import { buildQueue, queueActionFor } from "./queue";
import type { Expense, ExpenseStatus, Role } from "./types";

// The dashboard's whole content. What makes this worth testing is the property
// the old role-block dashboard did not have: one utlägg is waiting on at most
// one person, and holding more roles must never make the same row appear twice.

const ME = "u_me";
const SOMEONE_ELSE = "u_other";

const viewer = (roles: Role[], id = ME) => ({ id, roles });

// Only the fields the queue actually reads; cast once here rather than building
// a full Expense in every case.
function expense(over: Partial<Expense> & { status: ExpenseStatus }): Expense {
  return {
    id: "e_1",
    reference: "DEK26-0001",
    title: "Fika till mötet",
    submitterId: ME,
    submitterName: "Jag",
    submitterStudentId: "ja1234ge-s",
    allocations: [],
    paymentType: "CARD",
    purchaseDate: "2026-07-01",
    grossAmount: 250,
    currency: "SEK",
    submitterHasPayout: true,
    revisions: [],
    ...over,
  } as Expense;
}

describe("queueActionFor", () => {
  it("asks the submitter to fix an utlägg that came back", () => {
    expect(
      queueActionFor(expense({ status: "CHANGES_REQUESTED" }), viewer([])),
    ).toBe("FIX");
  });

  it("asks the submitter to send a draft", () => {
    expect(queueActionFor(expense({ status: "DRAFT" }), viewer([]))).toBe("SUBMIT");
  });

  it("asks the submitter to match a card purchase", () => {
    expect(queueActionFor(expense({ status: "PENDING_MATCH" }), viewer([]))).toBe(
      "MATCH",
    );
  });

  it("does not put someone else's draft in your queue", () => {
    const theirs = expense({ status: "DRAFT", submitterId: SOMEONE_ELSE });
    expect(queueActionFor(theirs, viewer(["SKATTMASTARE"]))).toBeNull();
  });

  it("asks a resultatansvarig to attest a row they hold", () => {
    const waiting = expense({
      status: "PENDING_APPROVAL",
      submitterId: SOMEONE_ELSE,
      allocations: [{ canAttest: true } as Expense["allocations"][number]],
    });
    expect(queueActionFor(waiting, viewer(["RESULTATANSVARIG"]))).toBe("ATTEST");
  });

  it("does not ask for an attest that has already been given", () => {
    const done = expense({
      status: "PENDING_APPROVAL",
      submitterId: SOMEONE_ELSE,
      allocations: [
        { canAttest: true, approvedById: "u_someone" } as Expense["allocations"][number],
      ],
    });
    expect(queueActionFor(done, viewer(["RESULTATANSVARIG"]))).toBeNull();
  });

  it("does not ask someone without the ownership to attest", () => {
    const waiting = expense({
      status: "PENDING_APPROVAL",
      submitterId: SOMEONE_ELSE,
      allocations: [{ canAttest: false } as Expense["allocations"][number]],
    });
    expect(queueActionFor(waiting, viewer(["RESULTATANSVARIG"]))).toBeNull();
  });

  it("asks skattmästeriet to book and to export", () => {
    const treasury = viewer(["SKATTMASTARE"]);
    expect(queueActionFor(expense({ status: "APPROVED" }), treasury)).toBe("BOOK");
    expect(queueActionFor(expense({ status: "BOOKED" }), treasury)).toBe("EXPORT");
  });

  it("does not ask a plain member to book anything", () => {
    expect(queueActionFor(expense({ status: "APPROVED" }), viewer([]))).toBeNull();
  });

  it("puts your own stuck utlägg ahead of your treasury duties", () => {
    // Same row, and the viewer is both the submitter and the bookkeeper. It is
    // waiting on them as a person before it is waiting on them as an office.
    const mineAndApproved = expense({ status: "CHANGES_REQUESTED" });
    expect(queueActionFor(mineAndApproved, viewer(["SKATTMASTARE"]))).toBe("FIX");
  });
});

describe("buildQueue", () => {
  it("leaves out everything that is waiting on somebody else", () => {
    const rows = [
      expense({ id: "A", status: "PENDING_APPROVAL", submitterId: SOMEONE_ELSE }),
      expense({ id: "B", status: "EXPORTED" }),
    ];
    expect(buildQueue(rows, viewer([]))).toEqual([]);
  });

  it("orders by urgency, then oldest first inside one action", () => {
    const rows = [
      expense({ id: "APPROVED_NEW", status: "APPROVED", purchaseDate: "2026-07-20" }),
      expense({ id: "APPROVED_OLD", status: "APPROVED", purchaseDate: "2026-01-02" }),
      expense({ id: "RETURNED", status: "CHANGES_REQUESTED", purchaseDate: "2026-07-30" }),
    ];
    expect(
      buildQueue(rows, viewer(["SKATTMASTARE"])).map((i) => i.expense.id),
    ).toEqual(["RETURNED", "APPROVED_OLD", "APPROVED_NEW"]);
  });

  it("never lists one utlägg twice, however many roles the viewer holds", () => {
    // The bug the old dashboard had: a skattmästare who also owned a
    // result unit rendered the attest block AND the bookkeeping block, so the
    // same work appeared under two headings.
    const rows = [
      expense({
        id: "WAITING",
        status: "PENDING_APPROVAL",
        submitterId: SOMEONE_ELSE,
        allocations: [{ canAttest: true } as Expense["allocations"][number]],
      }),
      expense({ id: "TO_BOOK", status: "APPROVED", submitterId: SOMEONE_ELSE }),
    ];
    const everyHat = viewer(["RESULTATANSVARIG", "SKATTMASTARE", "ORDFORANDE"]);
    const ids = buildQueue(rows, everyHat).map((i) => i.expense.id);

    expect(ids).toEqual(["WAITING", "TO_BOOK"]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
