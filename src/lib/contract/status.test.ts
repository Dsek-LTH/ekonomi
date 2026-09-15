import { describe, expect, it } from "vitest";
import { canEditRental, contractStatus, displayStatus, isExpired } from "./status";

const TODAY = "2026-09-06";

describe("contractStatus", () => {
  it("is signed once the signed copy is in the archive", () => {
    expect(
      contractStatus({ kind: "CONTRACT", files: [{ role: "GENERATED" }, { role: "SIGNED" }] }),
    ).toBe("SIGNED");
  });

  it("is a draft until then, whatever else has been uploaded", () => {
    expect(contractStatus({ kind: "CONTRACT", files: [] })).toBe("DRAFT");
    expect(
      contractStatus({ kind: "CONTRACT", files: [{ role: "ORIGINAL" }, { role: "ATTACHMENT" }] }),
    ).toBe("DRAFT");
  });

  it("gives a lean document no status at all", () => {
    expect(contractStatus({ kind: "PROTOCOL", files: [{ role: "SIGNED" }] })).toBeNull();
    expect(contractStatus({ kind: "OTHER", files: [] })).toBeNull();
  });
});

describe("isExpired", () => {
  it("expires a signed contract once its last day has passed", () => {
    expect(isExpired({ status: "SIGNED", validTo: "2026-09-05" }, TODAY)).toBe(true);
  });

  it("keeps it in force on its last day", () => {
    expect(isExpired({ status: "SIGNED", validTo: TODAY }, TODAY)).toBe(false);
  });

  it("never expires a contract with no end date", () => {
    expect(isExpired({ status: "SIGNED", validTo: null }, TODAY)).toBe(false);
  });

  it("does not expire a draft, which was abandoned rather than lapsed", () => {
    expect(isExpired({ status: "DRAFT", validTo: "2019-01-01" }, TODAY)).toBe(false);
  });
});

describe("displayStatus", () => {
  it("reports the status when nothing has lapsed", () => {
    expect(displayStatus({ status: "DRAFT", validTo: null }, TODAY)).toBe("DRAFT");
  });

  it("reports EXPIRED in place of SIGNED once the end date is past", () => {
    expect(displayStatus({ status: "SIGNED", validTo: "2020-06-30" }, TODAY)).toBe("EXPIRED");
  });

  it("has nothing to show for a lean document", () => {
    expect(displayStatus({ status: null, validTo: null }, TODAY)).toBeNull();
  });
});

describe("canEditRental", () => {
  it("allows edits until the signed copy is uploaded", () => {
    expect(canEditRental({ files: [] })).toBe(true);
    expect(canEditRental({ files: [{ role: "GENERATED" }, { role: "ATTACHMENT" }] })).toBe(true);
  });

  it("locks once a signed copy or signing evidence is in the archive", () => {
    expect(canEditRental({ files: [{ role: "GENERATED" }, { role: "SIGNED" }] })).toBe(false);
    expect(canEditRental({ files: [{ role: "EVIDENCE" }] })).toBe(false);
  });
});
