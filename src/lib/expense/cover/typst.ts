// The Typst implementation of `CoverRenderer`.
//
// What is left of this file after the compiler moved to lib/server/typst.ts:
// which template draws a cover, and what its failure is called. Everything
// above it still sees `renderCover(data) => Promise<Uint8Array>` and nothing
// else, so replacing Typst with a LaTeX or a sidecar implementation is a matter
// of writing that same signature, see cover/types.ts.
//
// The receipt is deliberately NOT embedded by the template. Typst can include
// PDF pages, but doing so imposes its constraints on the input: an embedded
// PDF's version may not exceed the export target's, encrypted files are refused
// outright, and nothing in the language reports how many pages a document has
// (typst#6644). Receipts come from whatever a supplier's till prints. So the
// cover is a fixed page built only from our own data, and pdf-lib (which is
// built for input nobody chose) staples the underlag on afterwards.
import "server-only";

import path from "node:path";

import { typeset, TypstError } from "@/lib/server/typst";

import type { CoverRenderer, ExpenseCoverData } from "./types";

const TEMPLATE = path.join(process.cwd(), "src/lib/expense/cover/expense-cover.typ");

/**
 * Kept as its own class, and thrown from here rather than let TypstError
 * through: `document.ts` catches this to tell a cover that would not draw from
 * a database that would not answer, and that distinction is about the cover
 * rather than about the typesetter.
 */
export class CoverRenderError extends Error {}

export const renderCover: CoverRenderer = async (data: ExpenseCoverData) => {
  try {
    return await typeset(TEMPLATE, data, "the cover page");
  } catch (e) {
    throw new CoverRenderError(
      e instanceof TypstError ? e.message : "the cover page could not be typeset",
    );
  }
};
