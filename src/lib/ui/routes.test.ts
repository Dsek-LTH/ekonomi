import { describe, expect, it } from "vitest";

import { samePath } from "./routes";

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
