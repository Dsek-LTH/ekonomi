import { describe, expect, it } from "vitest";

import { CAPABILITIES } from "@/lib/domain/permissions";
import { CapabilityName } from "./admin";

// CAPABILITIES (what Roller draws tickboxes for) and CapabilityName (what the route accepts) are written by hand, so a
// capability in one but not the other is a box that ticks and fails to save.
describe("the capabilities the authority routes accept", () => {
  it("covers every capability the settings grid can offer", () => {
    for (const capability of CAPABILITIES) {
      expect(CapabilityName.options).toContain(capability);
    }
  });

  it("names nothing the grid does not draw", () => {
    // The other direction: a value the route takes but no screen can send.
    for (const capability of CapabilityName.options) {
      expect(CAPABILITIES).toContain(capability);
    }
  });
});
