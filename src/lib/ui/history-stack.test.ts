import { describe, expect, it } from "vitest";

import { applyNav, backTarget, EMPTY_STACK, exitTarget, returnTarget, type NavStack } from "./history-stack";

// The nav, as far as these tests are concerned: three sections and nothing
// else. The real one is derived from app-shell's SECTION_LABELS.
const sections: Record<string, string> = {
  "/expenses": "expenses",
  "/bookkeeping": "bookkeeping",
  "/stock": "stock",
};
const sectionLabel = (path: string) => sections[path] ?? null;

/** A stack built by walking the URLs as pushes, standing on the last one. */
const walk = (...urls: string[]): NavStack =>
  urls.reduce((stack, url) => applyNav(stack, url, "push"), EMPTY_STACK);

describe("applyNav", () => {
  it("starts the trip wherever it finds itself", () => {
    // A reload, a pasted link, the first page of a session: whatever the intent
    // says, there is nothing behind us.
    expect(applyNav(EMPTY_STACK, "/expenses/1", "pop")).toEqual({
      entries: ["/expenses/1"],
      index: 0,
    });
  });

  it("ignores a move to the URL we are already on", () => {
    const stack = walk("/expenses");
    // Identity, not just equality: useSyncExternalStore re-renders on a new
    // object even when nothing about it changed.
    expect(applyNav(stack, "/expenses", "push")).toBe(stack);
  });

  it("overwrites in place on a replace, because no history entry was made", () => {
    // The case the old two-slot version got wrong: narrowing a list is done
    // with `replace`, and counting it as a move put the previous page at a URL
    // that was never in the browser's history at all.
    const stack = applyNav(walk("/expenses"), "/expenses?view=ALL", "replace");
    expect(stack).toEqual({ entries: ["/expenses?view=ALL"], index: 0 });
  });

  it("moves the finger back on a pop rather than recording a new visit", () => {
    const stack = applyNav(walk("/expenses", "/expenses/1"), "/expenses", "pop");
    expect(stack).toEqual({ entries: ["/expenses", "/expenses/1"], index: 0 });
  });

  it("moves it forward again on a Forward press", () => {
    const back = applyNav(walk("/expenses", "/expenses/1"), "/expenses", "pop");
    expect(applyNav(back, "/expenses/1", "pop").index).toBe(1);
  });

  it("drops what was ahead when you push from the middle", () => {
    const back = applyNav(walk("/expenses", "/expenses/1"), "/expenses", "pop");
    expect(applyNav(back, "/expenses/2", "push")).toEqual({
      entries: ["/expenses", "/expenses/2"],
      index: 1,
    });
  });

  it("starts over when a pop lands somewhere it has never recorded", () => {
    // Back out of a trip that began before this tab loaded us. The entries we
    // hold no longer describe the browser's history, and a delta measured
    // against them would send the next Back press somewhere arbitrary.
    expect(applyNav(walk("/expenses", "/expenses/1"), "/somewhere-else", "pop")).toEqual({
      entries: ["/somewhere-else"],
      index: 0,
    });
  });

  it("prefers the nearer entry backwards when a URL appears twice", () => {
    const stack = walk("/expenses", "/expenses/1", "/expenses", "/expenses/2");
    expect(applyNav(stack, "/expenses", "pop").index).toBe(2);
  });

  it("keeps the trip bounded without disturbing the distances in it", () => {
    let stack = EMPTY_STACK;
    for (let i = 0; i < 60; i++) stack = applyNav(stack, `/expenses/${i}`, "push");
    expect(stack.entries).toHaveLength(50);
    expect(stack.index).toBe(49);
    // Still on the last page pushed, and the one before it is still one back.
    expect(stack.entries[stack.index]).toBe("/expenses/59");
    expect(stack.entries[stack.index - 1]).toBe("/expenses/58");
  });
});

describe("backTarget", () => {
  it("returns the list as you left it, not the route that names it", () => {
    // The whole reason any of this exists: "Alla", page 2, is a different
    // screen from "/expenses", and it is the one you were looking at.
    const stack = walk("/expenses?view=ALL&page=2", "/expenses/1");
    expect(backTarget(stack, "/expenses", sectionLabel)).toEqual({
      url: "/expenses?view=ALL&page=2",
      delta: 1,
      section: null,
    });
  });

  it("names the section you actually came through", () => {
    // An utlägg opened from Bokföring. "← Utlägg" would send you somewhere you
    // had never been.
    const stack = walk("/bookkeeping?view=TODO", "/expenses/1");
    expect(backTarget(stack, "/expenses", sectionLabel)).toEqual({
      url: "/bookkeeping?view=TODO",
      delta: 1,
      section: "bookkeeping",
    });
  });

  it("reaches a section two pages back in one step", () => {
    // Bokföring → the utlägg → its booking screen. The old version could only
    // go back one entry, so from here it pushed the list forward instead and
    // left the utlägg sitting on the Back button.
    const stack = walk("/bookkeeping", "/expenses/1", "/expenses/1/book");
    expect(backTarget(stack, "/expenses", sectionLabel)).toEqual({
      url: "/bookkeeping",
      delta: 2,
      section: "bookkeeping",
    });
  });

  it("does not offer a section to a page whose parent is not one", () => {
    // The booking screen's parent is one utlägg. A section is not a substitute
    // for it. You would be sent past the thing you were working on.
    const stack = walk("/bookkeeping", "/expenses/1", "/expenses/1/book");
    expect(backTarget(stack, "/expenses/1", sectionLabel)).toEqual({
      url: "/expenses/1",
      delta: 1,
      section: null,
    });
  });

  it("takes the nearest qualifying entry, not the first one visited", () => {
    const stack = walk("/bookkeeping", "/expenses?view=MINE", "/expenses/1");
    expect(backTarget(stack, "/expenses", sectionLabel)?.url).toBe("/expenses?view=MINE");
  });

  it("gives nothing when there is nothing behind you", () => {
    // A link someone sent you: the page's own declared parent is the answer,
    // and pushing it is the only way to get there.
    expect(backTarget(walk("/expenses/1"), "/expenses", sectionLabel)).toBeNull();
  });

  it("gives nothing when a section is only reachable through unrelated pages", () => {
    // Ten entries back is not "where you came from" in any sense a reader
    // would recognise.
    const wander = Array.from({ length: 12 }, (_, i) => `/faq#${i}`);
    expect(backTarget(walk("/expenses", ...wander), "/expenses", sectionLabel)).toBeNull();
  });

  it("never offers somewhere ahead of you", () => {
    // Standing on the list after a Back press, with the utlägg still in front.
    const stack = applyNav(walk("/expenses", "/expenses/1"), "/expenses", "pop");
    expect(backTarget(stack, "/expenses", sectionLabel)).toBeNull();
  });
});

describe("exitTarget", () => {
  const inSettings = (path: string) => path === "/admin" || path.startsWith("/admin/");

  it("skips past every settings page to the one before them", () => {
    // Not backTarget's job: /admin/roles is a section in its own right, and
    // backTarget would happily stop there. Leaving settings means leaving all
    // of it, however many settings pages were visited along the way.
    const stack = walk("/expenses/1", "/admin/roles", "/admin/users");
    expect(exitTarget(stack, inSettings)).toEqual({ url: "/expenses/1", delta: 2 });
  });

  it("reaches straight past a single settings page", () => {
    const stack = walk("/budget/1", "/admin/cards");
    expect(exitTarget(stack, inSettings)).toEqual({ url: "/budget/1", delta: 1 });
  });

  it("gives nothing when there is nothing behind but settings itself", () => {
    // A settings link opened in a fresh tab: the caller's own fallback,
    // pushed, is the only way out.
    expect(exitTarget(walk("/admin/roles"), inSettings)).toBeNull();
  });

  it("gives nothing when the trip never left settings within the scan limit", () => {
    const wander = Array.from({ length: 12 }, (_, i) => `/admin/roles#${i}`);
    expect(exitTarget(walk("/expenses", ...wander), inSettings)).toBeNull();
  });
});

describe("returnTarget", () => {
  it("finds the page a finished mutation came from", () => {
    // Booking: the utlägg is the entry directly behind the form, so returning
    // is a pop and the form stops sitting on the Back button.
    const stack = walk("/expenses", "/expenses/1", "/expenses/1/book");
    expect(returnTarget(stack, "/expenses/1")).toEqual({ url: "/expenses/1", delta: 1 });
  });

  it("finds the list a deleted thing was opened from", () => {
    const stack = walk("/expenses?view=ALL", "/expenses/1");
    expect(returnTarget(stack, "/expenses")).toEqual({ url: "/expenses?view=ALL", delta: 1 });
  });

  it("gives nothing for somewhere that did not exist until now", () => {
    // The wizard's new utlägg. Nothing to return to, so the caller replaces
    // the wizard's entry instead of pushing past it.
    const stack = walk("/expenses", "/expenses/new");
    expect(returnTarget(stack, "/expenses/abc123")).toBeNull();
  });

  it("does not call a coincidence four pages back a return", () => {
    const stack = walk("/expenses", "/faq", "/dashboard", "/stock", "/stock/1");
    expect(returnTarget(stack, "/expenses")).toBeNull();
  });
});
