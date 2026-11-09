import { describe, expect, it } from "vitest";

import { owningRoute } from "./routes";

describe("owningRoute", () => {
  // The app's sections as app-shell derives them. Only the stock three share a prefix.
  const sections = [
    "/dashboard",
    "/expenses",
    "/bank",
    "/approvals",
    "/budget",
    "/bookkeeping",
    "/income",
    "/stock",
    "/stock/events",
    "/stock/history",
    "/faq",
  ];
  const owner = (path: string) => owningRoute(path, sections);

  it("gives the section to the section itself", () => {
    expect(owner("/expenses")).toBe("/expenses");
    expect(owner("/stock")).toBe("/stock");
  });

  it("gives a page the section it sits under", () => {
    expect(owner("/expenses/abc123")).toBe("/expenses");
    expect(owner("/expenses/abc123/book")).toBe("/expenses");
    // A product page, which the nav does not list. Produkter owns it.
    expect(owner("/stock/xyz")).toBe("/stock");
  });

  it("gives a nested section to itself and not to the one above it", () => {
    // /stock is a prefix of /stock/events, but only one should light.
    expect(owner("/stock/events")).toBe("/stock/events");
    expect(owner("/stock/history")).toBe("/stock/history");
  });

  it("keeps a nested section's own pages", () => {
    expect(owner("/stock/events/42")).toBe("/stock/events");
  });

  it("does not let a prefix cross a route boundary", () => {
    // The reason the match is on `${route}/` and not on the bare string.
    expect(owner("/stockholm")).toBeNull();
    expect(owner("/expenses-archive")).toBeNull();
  });

  it("gives nothing to a page no section owns", () => {
    // /profile carries its own heading; the top bar falls back to the brand.
    expect(owner("/profile")).toBeNull();
    expect(owner("/")).toBeNull();
  });

  it("is not confused by a section named inside another path", () => {
    // /admin/income must not belong to /income.
    expect(owner("/admin/income")).toBeNull();
  });

  it("does not depend on the order the routes are given in", () => {
    expect(owningRoute("/stock/events", ["/stock/events", "/stock"])).toBe("/stock/events");
    expect(owningRoute("/stock/events", ["/stock", "/stock/events"])).toBe("/stock/events");
  });
});
