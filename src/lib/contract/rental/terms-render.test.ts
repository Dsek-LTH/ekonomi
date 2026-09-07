import { describe, expect, it } from "vitest";
import path from "node:path";
import { NodeCompiler } from "@myriaddreamin/typst-ts-node-compiler";

import { RENTAL_TERMS, TERMS_VERSION, type TermsSection } from "./terms";
import type { RentalContractData } from "./types";

// Whether every kind of clause block actually reaches the page.
//
// The template branches on `TermsBlock.kind`, and the failure this guards
// against is silent: add a fourth kind to terms.ts, forget the branch, and the
// clause renders with that part simply missing. Nothing throws, the PDF still
// has pages, and the term nobody can see is the one that is not agreed to.
//
// Measured by counting drawn glyphs in the SVG rather than by reading the PDF,
// which needs no rasteriser. Removing a block should cost the page roughly the
// characters that block held.

const compiler = NodeCompiler.create({
  workspace: process.cwd(),
  fontArgs: [{ fontPaths: [path.join(process.cwd(), "src/lib/expense/cover/fonts")] }],
});

const party = (name: string) => ({
  name,
  title: null,
  orgName: null,
  orgNo: null,
  email: null,
  phone: null,
});

const withTerms = (terms: readonly TermsSection[]): RentalContractData => ({
  lessor: { name: "D-sektionen", orgNo: "845003-2878", address: "Gatan 1", postalLine: "223 63 Lund" },
  counterparty: "F-sektionen",
  counterpartyOrgNo: "845002-5678",
  counterpartyAddress: "Gatan 2",
  counterpartyPostalLine: "223 63 Lund",
  title: "Uthyrning",
  drawn: "2026-09-07",
  pickupAt: "2026-09-18",
  returnAt: "2026-09-21",
  purpose: null,
  place: "Kårhuset",
  lines: [
    { description: "Högtalare", quantity: "1 st", unitPrice: "1,00 kr",
      discount: null, lineTotal: "1,00 kr", replacementValue: "1,00 kr" },
  ],
  anyDiscount: false,
  subtotal: "1,00 kr",
  discount: null,
  price: "1,00 kr",
  paymentDue: null,
  totalReplacement: "1,00 kr",
  sectionParty: party("Maja Holm"),
  counterpartyParty: party("Emil Helander"),
  terms,
  termsVersion: TERMS_VERSION,
});

const glyphs = (terms: readonly TermsSection[]): number => {
  const svg = compiler.svg({
    mainFilePath: path.join(process.cwd(), "src/lib/contract/rental/rental-contract.typ"),
    inputs: { data: JSON.stringify(withTerms(terms)) },
  });
  return (svg!.match(/<use /g) ?? []).length;
};

/** The clauses with every block of one kind taken out. */
const without = (kind: string): TermsSection[] =>
  RENTAL_TERMS.map((s) => ({ ...s, body: s.body.filter((b) => b.kind !== kind) }));

/** How many characters the blocks of one kind carry between them. */
const charsIn = (kind: string): number =>
  RENTAL_TERMS.flatMap((s) => s.body).reduce((n, b) => {
    if (b.kind !== kind) return n;
    if (b.kind === "table") return n + b.head.join("").length + b.rows.flat().join("").length;
    if (b.kind === "list") return n + b.items.join("").length;
    return n + b.text.length;
  }, 0);

describe("every kind of clause block reaches the page", () => {
  // A space that falls at a line break is not drawn, so the glyph count runs a
  // little under the character count. Anything near it means the text is there;
  // a branch the template forgot would cost ~0.
  it.each(["text", "table", "list"])("%s", (kind) => {
    const chars = charsIn(kind);
    expect(chars, `no ${kind} blocks left in RENTAL_TERMS to test`).toBeGreaterThan(0);
    const lost = glyphs(RENTAL_TERMS) - glyphs(without(kind));
    expect(lost).toBeGreaterThan(chars * 0.9);
  });
});
