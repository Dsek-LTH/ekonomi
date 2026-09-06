// The Typst implementation of `RentalContractRenderer`.
//
// The second caller of lib/server/typst.ts, and the reason that module was
// lifted out of the expense cover in the first place: one warm compiler, one
// set of vendored faces, and a template named per document. Everything above
// this sees `renderRentalContract(data) => Promise<Uint8Array>` and nothing
// else, so replacing Typst is a matter of writing that same signature.
import "server-only";

import path from "node:path";

import { typeset, TypstError } from "@/lib/server/typst";

import type { RentalContractData, RentalContractRenderer } from "./types";

const TEMPLATE = path.join(process.cwd(), "src/lib/contract/rental/rental-contract.typ");

/**
 * Its own class rather than letting TypstError through, for the same reason
 * `CoverRenderError` is one: lib/contract/document.ts catches this to tell a
 * document that would not draw from a database that would not answer, and that
 * distinction is about the contract rather than about the typesetter.
 */
export class RentalRenderError extends Error {}

export const renderRentalContract: RentalContractRenderer = async (
  data: RentalContractData,
) => {
  try {
    return await typeset(TEMPLATE, data, "the rental contract");
  } catch (e) {
    throw new RentalRenderError(
      e instanceof TypstError ? e.message : "the rental contract could not be typeset",
    );
  }
};
