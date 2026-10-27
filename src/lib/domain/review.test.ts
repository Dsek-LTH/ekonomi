import { describe, expect, it } from "vitest";
import { bookedBy, reviewBlocker, reviewWarnings, voucherTextPrefix } from "./review";

describe("bookedBy", () => {
  it("is whoever konterade it and whoever amended the rows since", () => {
    expect(
      bookedBy([
        { type: "SUBMITTED", actorId: "member" },
        { type: "EDITED", actorId: "member" },
        { type: "BOOKED", actorId: "anna" },
        { type: "EDITED", actorId: "bertil" },
        { type: "EDITED", actorId: "anna" },
      ]),
    ).toEqual(["anna", "bertil"]);
  });

  it("starts over when it is konterat again", () => {
    expect(
      bookedBy([
        { type: "BOOKED", actorId: "anna" },
        { type: "EDITED", actorId: "anna" },
        { type: "BOOKED", actorId: "bertil" },
      ]),
    ).toEqual(["bertil"]);
  });

  it("is nobody before it is konterat", () => {
    expect(bookedBy([{ type: "EDITED", actorId: "member" }])).toEqual([]);
  });
});

describe("reviewBlocker", () => {
  const base = { exempt: false, viewerId: "anna", bookedBy: ["anna"] };

  it("refuses whoever konterade it", () => {
    expect(reviewBlocker(base)).toBe("ownBooking");
  });

  it("lets anybody else through", () => {
    expect(reviewBlocker({ ...base, viewerId: "bertil" })).toBeNull();
  });

  it("does not apply to the exempt", () => {
    expect(reviewBlocker({ ...base, exempt: true })).toBeNull();
  });
});

describe("reviewWarnings", () => {
  const ok = {
    date: "2026-05-01",
    financialYears: [{ fromDate: "2026-01-01", toDate: "2026-12-31" }],
    description: "PU lu1234ge-s Pennor",
    textPrefix: voucherTextPrefix("REIMBURSEMENT", "lu1234ge-s"),
    lines: [{ account: "5010", costCenterCode: "INFU", project: "12" }],
    isActiveAccount: () => true,
    isActiveCostCenter: () => true,
    isActiveProject: () => true,
  };

  it("says nothing about an ordinary utlägg", () => {
    expect(reviewWarnings(ok)).toEqual([]);
  });

  it("names each thing worth a second look", () => {
    expect(
      reviewWarnings({
        ...ok,
        date: "2027-02-01",
        description: "PU lu1234ge-s",
        isActiveAccount: () => false,
        isActiveCostCenter: () => false,
        isActiveProject: () => false,
      }),
    ).toEqual([
      "outsideFinancialYear",
      "prefixOnlyText",
      "inactiveAccount",
      "inactiveCostCenter",
      "inactiveProject",
    ]);
  });

  it("does not judge a date with no years synced", () => {
    expect(reviewWarnings({ ...ok, financialYears: [], date: "1999-01-01" })).toEqual([]);
  });
});
