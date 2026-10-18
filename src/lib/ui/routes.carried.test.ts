import { describe, expect, it } from "vitest";
import { carriedSection } from "./routes";

const ROUTES = ["/dashboard", "/expenses", "/approvals", "/bookkeeping", "/stock", "/stock/events"];

describe("carriedSection", () => {
  it("lights a nav route as itself, whatever came before", () => {
    expect(carriedSection("/expenses", "/approvals", ROUTES)).toBe("/expenses");
    expect(carriedSection("/approvals", "/expenses", ROUTES)).toBe("/approvals");
  });

  it("keeps the section an utlägg was opened from", () => {
    expect(carriedSection("/expenses/abc", "/approvals", ROUTES)).toBe("/approvals");
    expect(carriedSection("/expenses/abc/book", "/bookkeeping", ROUTES)).toBe("/bookkeeping");
  });

  it("falls back to the URL with nothing before it", () => {
    expect(carriedSection("/expenses/abc", null, ROUTES)).toBe("/expenses");
  });

  it("is unaffected by a query or a trailing slash on a nav route", () => {
    expect(carriedSection("/expenses/", "/approvals", ROUTES)).toBe("/expenses");
  });
});
