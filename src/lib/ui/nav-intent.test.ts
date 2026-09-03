import { afterEach, describe, expect, it, vi } from "vitest";

import { noteIntent, takeIntent } from "./nav-intent";

afterEach(() => {
  vi.useRealTimers();
  // The latch is module state, and a note left behind by one test is exactly
  // the bug the note's address exists to stop. Clear it between them.
  takeIntent("/nowhere");
});

describe("takeIntent", () => {
  it("calls an unannounced navigation a push", () => {
    expect(takeIntent("/expenses/1")).toBe("push");
  });

  it("believes a note about the address that arrived", () => {
    noteIntent("replace", "/expenses?view=ALL");
    expect(takeIntent("/expenses?view=ALL")).toBe("replace");
  });

  it("does not care what order the query is written in", () => {
    // One end writes the URL with listQueryToSearch, the other reads it back
    // out of useSearchParams. Neither promises the other an order.
    noteIntent("replace", "/expenses?view=ALL&q=hotell");
    expect(takeIntent("/expenses?q=hotell&view=ALL")).toBe("replace");
  });

  it("ignores a note about somewhere else", () => {
    // The bug: the search box commits on a timer, and that timer can fire just
    // after a row was clicked. The replace it states is about the list, and
    // reading it for the utlägg that arrives overwrote the list in the stack.
    noteIntent("replace", "/expenses?q=hotell");
    expect(takeIntent("/expenses/1")).toBe("push");
  });

  it("does not leave a note lying around for the next navigation", () => {
    // A replace to the address you are already on (clicking "Alla" while the
    // list already shows Alla) moves no URL, so nothing consumes its note.
    noteIntent("replace", "/expenses?view=ALL");
    expect(takeIntent("/expenses/1")).toBe("push");
    expect(takeIntent("/expenses?view=ALL")).toBe("push");
  });

  it("stops believing a note the navigation never acted on", () => {
    vi.useFakeTimers();
    noteIntent("replace", "/expenses?view=ALL");
    vi.advanceTimersByTime(60_000);
    expect(takeIntent("/expenses?view=ALL")).toBe("push");
  });

  it("carries a Back press, which is where popstate leaves the address", () => {
    noteIntent("pop", "/expenses?view=ALL");
    expect(takeIntent("/expenses?view=ALL")).toBe("pop");
  });
});
