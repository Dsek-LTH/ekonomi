import { describe, expect, it } from "vitest";
import { ANY_CC, NO_CC, costCenterMatcher, costCenterWhere, parseCostCenters } from "./cost-center-filter";

const params = (q: string) => new URLSearchParams(q);

describe("parseCostCenters", () => {
  it("reads no param as every cost centre", () => {
    expect(parseCostCenters(params(""))).toBeUndefined();
  });

  it("keeps an empty param, which is the no-cost-centre bucket", () => {
    expect(parseCostCenters(params("costCenter="))).toEqual([NO_CC]);
  });

  it("reads repeated params, once each", () => {
    expect(parseCostCenters(params("costCenter=INFU&costCenter=*&costCenter=INFU"))).toEqual([
      "INFU",
      ANY_CC,
    ]);
  });
});

describe("costCenterMatcher", () => {
  it("matches everything without a filter", () => {
    const m = costCenterMatcher(undefined);
    expect([m(NO_CC), m("INFU")]).toEqual([true, true]);
  });

  it("matches a named code and nothing else", () => {
    const m = costCenterMatcher(["INFU"]);
    expect([m("INFU"), m("SEXM"), m(NO_CC)]).toEqual([true, false, false]);
  });

  it("matches every code but not the bucket for 'with a cost centre'", () => {
    const m = costCenterMatcher([ANY_CC]);
    expect([m("INFU"), m("SEXM"), m(NO_CC)]).toEqual([true, true, false]);
  });

  it("matches both sides when both buckets are picked", () => {
    const m = costCenterMatcher([ANY_CC, NO_CC]);
    expect([m("INFU"), m(NO_CC)]).toEqual([true, true]);
  });
});

describe("costCenterWhere", () => {
  it("adds nothing without a filter", () => {
    expect(costCenterWhere(undefined)).toEqual({});
  });

  it("matches a null code and an empty one for the no-cost-centre bucket", () => {
    expect(costCenterWhere([NO_CC])).toEqual({
      OR: [{ costCenterCode: null }, { costCenterCode: "" }],
    });
  });

  it("excludes both null and empty for 'with a cost centre'", () => {
    expect(costCenterWhere([ANY_CC])).toEqual({
      OR: [{ AND: [{ costCenterCode: { not: null } }, { costCenterCode: { not: "" } }] }],
    });
  });
});
