import { describe, expect, it } from "vitest";

import { owningRoute, samePath, urlKey } from "./routes";

describe("samePath", () => {
  it("ignores the query, which is the whole point", () => {
    // The case the back link exists for: the list you left carried its scope
    // and its page in the query, and the link that names the route has neither.
    expect(samePath("/expenses?view=ALL&page=2", "/expenses")).toBe(true);
  });

  it("ignores a fragment", () => {
    expect(samePath("/budget#sheet", "/budget")).toBe(true);
  });

  it("says no to a different route", () => {
    expect(samePath("/expenses/abc123", "/expenses")).toBe(false);
    expect(samePath("/approvals?view=ALL", "/expenses")).toBe(false);
  });

  it("does not mistake a child route for its parent", () => {
    // "/expenses/new" starts with "/expenses"; a prefix test would send the
    // back link on the booking screen to a page nobody asked for.
    expect(samePath("/expenses/new", "/expenses")).toBe(false);
  });

  it("treats a trailing slash as the same route", () => {
    expect(samePath("/expenses/", "/expenses")).toBe(true);
    expect(samePath("/", "/")).toBe(true);
  });
});

describe("urlKey", () => {
  it("is the same key for the same screen spelled two ways", () => {
    expect(urlKey("/expenses?view=ALL&q=hotell")).toBe(urlKey("/expenses?q=hotell&view=ALL"));
  });

  it("keeps two screens of one route apart", () => {
    expect(urlKey("/expenses?view=ALL")).not.toBe(urlKey("/expenses"));
    expect(urlKey("/expenses?view=ALL")).not.toBe(urlKey("/expenses?view=MINE"));
  });

  it("drops the fragment and a trailing slash, which name no screen", () => {
    expect(urlKey("/budget/#sheet")).toBe("/budget");
  });

  it("leaves a bare route alone", () => {
    expect(urlKey("/expenses")).toBe("/expenses");
    expect(urlKey("/expenses?")).toBe("/expenses");
  });
});

describe("owningRoute", () => {
  // The app's sections, as app-shell derives them from the nav. Only the stock
  // three share a prefix, and they are the reason this exists.
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
    "/stock/log",
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
    // The bug this replaced: the sidebar lit Produkter *and* Tillfällen here,
    // because /stock is a prefix of /stock/events.
    expect(owner("/stock/events")).toBe("/stock/events");
    expect(owner("/stock/log")).toBe("/stock/log");
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
