import { describe, expect, it } from "vitest";

import { buildCoverData, coverFilename } from "./document";

// The wording decisions, asserted without a typesetter anywhere in sight. That
// is the whole reason `buildCoverData` takes a plain object and returns one:
// swapping Typst for LaTeX changes how this data is placed and none of what it
// says, so these tests survive the swap — see cover/types.ts.

const TODAY = new Date("2026-08-14T09:30:00Z");

const base = {
  reference: "DEK26-0042",
  title: "FREETRAILER: Hyrning",
  purchaseDate: new Date("2026-03-19T00:00:00Z"),
  paymentType: "REIMBURSEMENT",
  grossAmount: 6900,
  submitter: { name: "Emil Helander", studentId: "em8241he-s" },
  allocations: [
    {
      amount: 6900,
      comment: null,
      approvedAt: new Date("2026-04-02T11:00:00Z"),
      costCenter: { code: "SEKT05", name: "Sexmästeriet" },
      approvedBy: { name: "Ludwig Gehlsdorf" },
    },
  ],
};

describe("buildCoverData", () => {
  it("states the utlägg in Swedish, formatted and ready to place", () => {
    const d = buildCoverData(base, TODAY);
    expect(d.reference).toBe("DEK26-0042");
    expect(d.paymentType).toBe("Privat utlägg");
    expect(d.purchaseDate).toBe("2026-03-19");
    expect(d.created).toBe("2026-08-14");
    expect(d.submitter).toEqual({ name: "Emil Helander", studentId: "em8241he-s" });
  });

  it("words a section card differently from an out-of-pocket utlägg", () => {
    expect(buildCoverData({ ...base, paymentType: "CARD" }, TODAY).paymentType).toBe(
      "Sektionskort",
    );
  });

  it("formats amounts as Swedish kronor, thousands separated", () => {
    const d = buildCoverData(
      { ...base, allocations: [{ ...base.allocations[0], amount: 106900 }] },
      TODAY,
    );
    // A non-breaking space is what sv-SE groups with, and the document wants
    // exactly that — "1 069,00 kr" must never break across a line.
    expect(d.total.replace(/ /g, " ")).toBe("1 069,00 kr");
    expect(d.allocations[0].amount.replace(/ /g, " ")).toBe("1 069,00 kr");
  });

  it("names each cost centre by code and name", () => {
    expect(buildCoverData(base, TODAY).allocations[0].costCenter).toBe(
      "SEKT05 · Sexmästeriet",
    );
  });

  it("totals the allocations rather than the recorded gross", () => {
    // The page is a statement about what was attested, and attestation is per
    // allocation — so a grossAmount that disagrees does not get to decide.
    const d = buildCoverData(
      {
        ...base,
        grossAmount: 999999,
        allocations: [
          { ...base.allocations[0], amount: 2500 },
          { ...base.allocations[0], amount: 1500 },
        ],
      },
      TODAY,
    );
    expect(d.total.replace(/ /g, " ")).toBe("40,00 kr");
  });

  it("leaves an unattested slice null rather than inventing a placeholder", () => {
    // How a missing approver reads is the template's decision, made once for
    // every field that can be absent — not smuggled in here as a dash.
    const d = buildCoverData(
      {
        ...base,
        allocations: [{ ...base.allocations[0], approvedBy: null, approvedAt: null }],
      },
      TODAY,
    );
    expect(d.allocations[0].approvedBy).toBeNull();
    expect(d.allocations[0].approvedAt).toBeNull();
  });

  it("survives an utlägg with no reference, purchase date or StiL-ID", () => {
    const d = buildCoverData(
      {
        ...base,
        reference: null,
        purchaseDate: null,
        submitter: { name: "Anon", studentId: null },
      },
      TODAY,
    );
    expect(d.reference).toBe("—");
    expect(d.purchaseDate).toBeNull();
    expect(d.submitter.studentId).toBeNull();
  });
});

describe("coverFilename", () => {
  it("names the file after the reference, falling back to the id", () => {
    expect(coverFilename("DEK26-0042", "cuid1")).toBe("utlaggsrakning-DEK26-0042.pdf");
    expect(coverFilename(null, "cuid1")).toBe("utlaggsrakning-cuid1.pdf");
  });
});
