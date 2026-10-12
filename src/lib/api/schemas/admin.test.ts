import { describe, expect, it } from "vitest";

import { CAPABILITIES } from "@/lib/domain/permissions";
import { CapabilityName } from "./admin";

// One test, and it exists because the two lists it compares are written out by
// hand in two files. CAPABILITIES is what Inställningar → Roller draws a tickbox
// for; CapabilityName is what the route accepts when that tickbox is saved. A
// capability in the first and not the second is a box that ticks and then fails
// to save, and the screen has nothing to say about why.
describe("the capabilities the authority routes accept", () => {
  it("covers every capability the settings grid can offer", () => {
    for (const capability of CAPABILITIES) {
      expect(CapabilityName.options).toContain(capability);
    }
  });

  it("names nothing the grid does not draw", () => {
    // The other direction: a value the route would take but no screen can send
    // is a permission that could only ever arrive by hand.
    for (const capability of CapabilityName.options) {
      expect(CAPABILITIES).toContain(capability);
    }
  });
});
