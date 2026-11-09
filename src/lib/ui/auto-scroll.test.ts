import { describe, expect, it } from "vitest";

import { edgeVelocity } from "./auto-scroll";

// The arithmetic half of drag auto-scroll (the DOM walk needs a document).

describe("edgeVelocity", () => {
  it("is nothing while the pointer is clear of the edge", () => {
    // A drag in the middle of the sheet must not creep.
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
    // Pointer outside the window: must not scroll backwards.
    expect(edgeVelocity(-50, 72, 18)).toBe(18);
  });
});
