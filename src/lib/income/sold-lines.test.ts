import { describe, expect, it } from "vitest";

import { soldSections, unplacedPrefix, type SectionLine } from "./sold-lines";

const line = (over: Partial<SectionLine> = {}): SectionLine => ({
  name: "Cola",
  variant: null,
  account: "3000",
  accountName: "Försäljning inom Sverige",
  unitPrice: 13,
  total: 13,
  ...over,
});

describe("soldSections", () => {
  it("is one section per account, in account order, each with its sum", () => {
    const got = soldSections(
      [line({ account: "3011", accountName: "Öl", total: 40 }), line(), line({ total: 0.1 }), line({ total: 0.2 })],
      false,
    );
    expect(got.map((s) => [s.account, s.accountName, s.total])).toEqual([
      ["3000", "Försäljning inom Sverige", 13.3],
      ["3011", "Öl", 40],
    ]);
  });

  it("groups products inside a section the way the document does", () => {
    const [section] = soldSections([line({ name: "Macka", variant: "Ost" }), line({ name: "Macka", variant: "Skinka" })], false);
    expect(section.rows.map((r) => (r.kind === "group" ? `# ${r.name}` : r.kind === "line" ? r.label : r.prefix))).toEqual([
      "# Macka",
      "Ost",
      "Skinka",
    ]);
  });

  it("pulls a reserv day's prefixed lines under their prefix, ahead of the rest", () => {
    const [section] = soldSections(
      [line({ name: "Biljett" }), line({ name: "s1 - Big Wave" }), line({ name: "s0 - Läsk" }), line({ name: "S0 - Drink" })],
      true,
    );
    expect(section.rows.map((r) => (r.kind === "prefix" ? `[${r.prefix} x${r.lines.length}]` : r.kind === "line" ? r.label : r.name))).toEqual([
      "[s0 x2]",
      "Drink",
      "Läsk",
      "[s1 x1]",
      "Big Wave",
      "Biljett",
    ]);
  });

  it("keeps a prefixed product's variants grouped, the prefix off both", () => {
    const [section] = soldSections(
      [line({ name: "s5 - Mat", variant: "s5 - Nachos" }), line({ name: "s5 - Mat", variant: "s5 - Billys" })],
      true,
    );
    expect(section.rows.map((r) => (r.kind === "prefix" ? `[${r.prefix}]` : r.kind === "group" ? `# ${r.name}` : r.label))).toEqual([
      "[s5]",
      "# Mat",
      "Billys",
      "Nachos",
    ]);
  });

  it("leaves a dash in a product's name alone on an ordinary day", () => {
    const [section] = soldSections([line({ name: "s0 - Läsk" })], false);
    expect(section.rows).toMatchObject([{ kind: "line", label: "s0 - Läsk" }]);
  });
});

describe("unplacedPrefix", () => {
  it("needs a dash, so a two-word product is not a prefix", () => {
    expect(unplacedPrefix("Coca cola co")).toBeNull();
    expect(unplacedPrefix("c-Cola")).toEqual({ prefix: "c", rest: "Cola" });
    expect(unplacedPrefix("s0 \u2013 Briska Hallon")).toEqual({ prefix: "s0", rest: "Briska Hallon" });
  });
});
