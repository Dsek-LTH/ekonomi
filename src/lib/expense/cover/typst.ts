// The Typst implementation of `CoverRenderer` (cover/types.ts).
// The template does NOT embed the receipt: Typst's PDF inclusion refuses encrypted files, caps the version
// and cannot count pages (typst#6644). pdf-lib staples the underlag on afterwards.
import "server-only";

import path from "node:path";

import { typeset, TypstError } from "@/lib/server/typst";

import type { CoverRenderer, ExpenseCoverData } from "./types";

const TEMPLATE = path.join(process.cwd(), "src/lib/expense/cover/expense-cover.typ");

/** Thrown instead of TypstError so document.ts can tell a cover that would not draw from a database that would not answer. */
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
