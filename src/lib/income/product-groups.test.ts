import { describe, expect, it } from "vitest";

import { productDisplayName, productRows, type GroupableLine } from "./product-groups";

const line = (over: Partial<GroupableLine> = {}): GroupableLine => ({
  name: "Cola",
  variant: null,
  account: "3000",
  unitPrice: 1300,
  ...over,
});

/** The shape a row reads as, so a test can say what a table would show. */
const shown = (lines: GroupableLine[]) =>
  productRows(lines).map((r) =>
    r.kind === "group" ? `${r.name}:` : r.indented ? `  ${r.label}` : r.label,
  );

describe("productRows", () => {
  it("leaves a product with no variants alone", () => {
    expect(shown([line(), line({ name: "Kaffe & bulle", account: "3010" })])).toEqual([
      "Cola",
      "Kaffe & bulle",
    ]);
  });

  it("gives a product with variants a heading and steps its rows in", () => {
    const got = shown([
      line({ name: "Macka", variant: "Skinka" }),
      line({ name: "Macka", variant: "Ost" }),
    ]);
    expect(got).toEqual(["Macka:", "  Ost", "  Skinka"]);
  });

  it("groups one variant as readily as several", () => {
    // `hasMultipleVariants` in intakt/report/pdf.go answers "any", not "several",
    // and this follows it: one variant is still a distinction worth showing.
    expect(shown([line({ name: "Läsk", variant: "Stor" })])).toEqual(["Läsk:", "  Stor"]);
  });

  it("steps a variant-less row of a grouped product in, under its own name", () => {
    // Unlike the document, which leaves it flush with the heading, where it read
    // as a separate product rather than one of the group's.
    expect(
      shown([line({ name: "Macka" }), line({ name: "Macka", variant: "Ost" })]),
    ).toEqual(["Macka:", "  Macka", "  Ost"]);
  });

  it("orders groups by name and rows by variant, then account, then price", () => {
    const got = shown([
      line({ name: "Öl", variant: "Stor", account: "3011" }),
      line({ name: "Öl", variant: "stor", account: "3011", unitPrice: 900 }),
      line({ name: "Öl", variant: "Liten", account: "3011" }),
      line({ name: "Chips" }),
    ]);
    // "Chips" before "Öl"; within the group Liten before both Stors, and the
    // cheaper of the two same-variant rows first. Case is ignored on the
    // variant, so "Stor" and "stor" sort together rather than apart.
    expect(got).toEqual(["Chips", "Öl:", "  Liten", "  stor", "  Stor"]);
  });

  it("groups a product whose name differs only by surrounding space", () => {
    expect(shown([line({ name: "Macka ", variant: "Ost" }), line({ name: "Macka" })])).toEqual([
      "Macka:",
      "  Macka",
      "  Ost",
    ]);
  });

  it("treats a blank variant as none", () => {
    expect(shown([line({ name: "Cola", variant: "  " })])).toEqual(["Cola"]);
  });

  it("gives every row a key of its own", () => {
    const rows = productRows([
      line({ name: "Macka", variant: "Ost" }),
      line({ name: "Macka", variant: "Ost", account: "3011" }),
      line({ name: "Cola" }),
    ]);
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
  });
});

describe("productDisplayName", () => {
  it("joins the name and the variant, as the document does", () => {
    expect(productDisplayName(line({ name: "Läsk", variant: "Stor" }))).toBe("Läsk Stor");
  });

  it("is the bare name without one", () => {
    expect(productDisplayName(line({ variant: "   " }))).toBe("Cola");
  });
});
