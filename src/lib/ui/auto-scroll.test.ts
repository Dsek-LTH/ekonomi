import { describe, expect, it } from "vitest";

import { edgeVelocity } from "./auto-scroll";

// The arithmetic half of dragging a row past the edge of the screen. The other
// half walks the DOM for the element that scrolls, which needs a document and
// is not what goes wrong here.

describe("edgeVelocity", () => {
  it("is nothing while the pointer is clear of the edge", () => {
    // The common case by far: a drag that stays in the middle of the sheet must
    // not creep the view a pixel at a time under the row being carried.
    expect(edgeVelocity(200, 72, 18)).toBe(0);
    expect(edgeVelocity(72, 72, 18)).toBe(0);
  });

  it("is full speed at the edge itself", () => {
    expect(edgeVelocity(0, 72, 18)).toBe(18);
  });

  it("ramps between the two, so approaching the edge speeds up", () => {
    expect(edgeVelocity(36, 72, 18)).toBe(9);
    expect(edgeVelocity(54, 72, 18)).toBe(4.5);
  });

  it("treats a pointer past the edge as being at it", () => {
    // The pointer leaves the window while a row is being dragged out of it.
    // Scrolling backwards there would carry the row away from where it is
    // being aimed.
    expect(edgeVelocity(-50, 72, 18)).toBe(18);
  });
});
