import { describe, expect, it } from "vitest";
import { rolesFromGroups, sameRoles } from "./authentik-roles";

describe("rolesFromGroups", () => {
  it("gives everyone the baseline role", () => {
    expect(rolesFromGroups([])).toEqual(["ORDINARIE"]);
    expect(rolesFromGroups(undefined)).toEqual(["ORDINARIE"]);
  });

  it("reads the treasury and the chair off their own groups", () => {
    expect(rolesFromGroups(["dsek.skattm.mastare"])).toContain("SKATTMASTARE");
    expect(rolesFromGroups(["dsek.ordf"])).toContain("ORDFORANDE");
  });

  it("treats a committee head as resultatansvarig", () => {
    expect(rolesFromGroups(["dsek.cafe.mastare"])).toContain("RESULTATANSVARIG");
    expect(rolesFromGroups(["dsek.fram.ordf"])).toContain("RESULTATANSVARIG");
  });

  it("does not make the skattmästare a resultatansvarig as well", () => {
    // `dsek.skattm.mastare` matches the committee-head shape too. It is named
    // explicitly, and the more specific reading is the one that counts.
    expect(rolesFromGroups(["dsek.skattm.mastare"])).not.toContain("RESULTATANSVARIG");
  });

  it("keeps every role a person holds", () => {
    const roles = rolesFromGroups(["dsek.ordf", "dsek.infu.mastare"]);
    expect(roles).toContain("ORDFORANDE");
    expect(roles).toContain("RESULTATANSVARIG");
  });

  it("ignores groups that mean nothing here", () => {
    // Authentik gains groups for reasons that have nothing to do with this app.
    expect(rolesFromGroups(["authentik Admins", "dsek.medlem"])).toEqual(["ORDINARIE"]);
  });

  it("is not confused by a committee named like a member group", () => {
    // Two segments is a committee; one is not, and neither is three under a
    // name that isn't a head position.
    expect(rolesFromGroups(["dsek.cafe"])).toEqual(["ORDINARIE"]);
    expect(rolesFromGroups(["dsek.cafe.mdlm"])).toEqual(["ORDINARIE"]);
  });

  it("does not grant anything to a lookalike outside the section", () => {
    expect(rolesFromGroups(["dsekX.ordf", "other.skattm.mastare"])).toEqual(["ORDINARIE"]);
  });
});

describe("sameRoles", () => {
  it("disregards order", () => {
    expect(sameRoles(["ORDINARIE", "SKATTMASTARE"], ["SKATTMASTARE", "ORDINARIE"])).toBe(true);
  });

  it("sees a role gained or lost", () => {
    expect(sameRoles(["ORDINARIE"], ["ORDINARIE", "SKATTFORMAN"])).toBe(false);
    expect(sameRoles(["ORDINARIE", "SKATTFORMAN"], ["ORDINARIE"])).toBe(false);
  });
});
