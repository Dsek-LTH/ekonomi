import path from "node:path";
import { NodeCompiler } from "@myriaddreamin/typst-ts-node-compiler";
import { describe, expect, it } from "vitest";

import { RENTAL_TERMS, TERMS_VERSION } from "./terms";
import type { RentalContractData, RentalContractLine } from "./types";

// Where the parts of a contract land on the page, for every length the
// equipment table can push them to.
//
// Three things must hold however many lines a rental has. The signatures never
// stand on a page with no villkor on it, a clause heading is never left at the
// foot of a page with its text starting on the next, and a sentence that
// introduces a table or a list is never left on a page without it. All three
// used to depend on where the page happened to break: one more line of gear
// moved the signatures onto a page of their own.
//
// The template marks those places with metadata (`<layout>`, see `mark` in
// rental-contract.typ), and this asks Typst which page each mark ended up on.
// Nothing is read out of a PDF.

const compiler = NodeCompiler.create({
  workspace: process.cwd(),
  fontArgs: [
    {
      fontPaths: [
        path.join(process.cwd(), "src/lib/expense/cover/fonts"),
        path.join(process.cwd(), "src/lib/server/fonts"),
      ],
    },
  ],
});

const TEMPLATE = path.join(process.cwd(), "src/lib/contract/rental/rental-contract.typ");

interface Mark {
  kind: "head" | "body" | "end" | "lead" | "follows" | "signatures";
  clause: number | null;
  /** For "lead" and "follows": the text part that introduces the table or list. */
  part: number | null;
  page: number;
}

const line = (n: number): RentalContractLine => ({
  description: `Högtalare ${n}`,
  quantity: "1 st",
  unitPrice: "100,00 kr",
  discount: null,
  lineTotal: "100,00 kr",
  replacementValue: "1 000,00 kr",
});

const base: RentalContractData = {
  lessor: { name: "D-sektionen inom TLTH", orgNo: "845003-2878", address: "Box 118", postalLine: "221 00 Lund" },
  counterparty: "F-sektionen inom TLTH",
  counterpartyOrgNo: "845002-5678",
  counterpartyAddress: "Ole Römers väg 3",
  counterpartyPostalLine: "223 63 Lund",
  counterpartyEmail: null,
  counterpartyPhone: null,
  title: "Uthyrning",
  drawn: "2026-09-15",
  pickupAt: "2026-09-18",
  returnAt: "2026-09-21",
  purpose: null,
  lines: [],
  anyDiscount: false,
  subtotal: "100,00 kr",
  discount: null,
  price: "100,00 kr",
  totalReplacement: "1 000,00 kr",
  signatureCount: 1,
  terms: RENTAL_TERMS,
  termsVersion: TERMS_VERSION,
};

const layout = (data: RentalContractData): Mark[] =>
  compiler
    .query(
      { mainFilePath: TEMPLATE, inputs: { data: JSON.stringify(data) } },
      { selector: "<layout>" },
    )
    .map((m: { value: Mark }) => m.value);

// Line marks are only placed in text parts, so these are the clauses the
// template can report on. See `mark` in the template for why.
const clausesOpeningWithText = RENTAL_TERMS.flatMap((c, i) => (c.body[0]?.kind === "text" ? [i] : []));
const lastClause = RENTAL_TERMS[RENTAL_TERMS.length - 1];
const endsWithText = lastClause.body[lastClause.body.length - 1]?.kind === "text";

// Every text part that is followed directly by a table or a list.
const introductions = RENTAL_TERMS.flatMap((c, clause) =>
  c.body.flatMap((b, part) =>
    b.kind === "text" && c.body[part + 1] && c.body[part + 1].kind !== "text" ? [{ clause, part }] : [],
  ),
);

// Thirty lines is well over a page of table, so between them these move every
// break across every clause. The purpose line shifts the whole document by a
// few millimetres more, for the breaks a whole table row steps over. Five
// signatures is the first count whose block is allowed to break.
const cases = [1, 5].flatMap((signatureCount) =>
  [null, "Sittning i iDét"].flatMap((purpose) =>
    Array.from({ length: 30 }, (_, i) => ({
      name: `${i + 1} lines, ${purpose ? "a purpose" : "no purpose"}, ${signatureCount} signature(s)`,
      data: { ...base, purpose, signatureCount, lines: Array.from({ length: i + 1 }, (_, n) => line(n + 1)) },
    })),
  ),
);

const results = cases.map(({ name, data }) => ({ name, marks: layout(data) }));
const pageOf = (marks: Mark[], kind: Mark["kind"], clause: number | null = null, part: number | null = null) =>
  marks.find((m) => m.kind === kind && m.clause === clause && m.part === part)?.page;

describe("rental contract page layout", () => {
  it("has a text part at the end of the last clause to hold the signatures to", () => {
    // If the villkor ever end on a table or a list, the template still keeps
    // them with the signatures, but this test can no longer see it. Add a mark
    // for that kind before relaxing this.
    expect(endsWithText).toBe(true);
  });

  it("covers page breaks at all, so the checks below are not passing on one page", () => {
    const signaturePages = new Set(results.map((r) => pageOf(r.marks, "signatures")));
    expect(signaturePages.size).toBeGreaterThan(1);
  });

  it.each(results)("$name: the signatures share a page with the villkor", ({ marks }) => {
    const signatures = pageOf(marks, "signatures");
    const end = pageOf(marks, "end", RENTAL_TERMS.length - 1);
    expect(signatures).toBeDefined();
    expect(signatures).toBe(end);
  });

  it.each(results)("$name: no clause heading is parted from its first line", ({ marks }) => {
    for (const i of clausesOpeningWithText) {
      expect(pageOf(marks, "head", i), `§ ${i + 1} ${RENTAL_TERMS[i].heading}`).toBe(pageOf(marks, "body", i));
    }
  });

  it("has a table or list introduced by a sentence, so the check below checks something", () => {
    expect(introductions.length).toBeGreaterThan(0);
  });

  it.each(results)("$name: no sentence is parted from the table or list it introduces", ({ marks }) => {
    for (const { clause, part } of introductions) {
      const where = `§ ${clause + 1}, part ${part + 1}`;
      const lead = pageOf(marks, "lead", clause, part);
      expect(lead, where).toBeDefined();
      expect(lead, where).toBe(pageOf(marks, "follows", clause, part));
    }
  });
});
