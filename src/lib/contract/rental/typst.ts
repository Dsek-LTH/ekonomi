// The Typst implementation of `RentalContractRenderer`, on the shared lib/server/typst.ts.
import "server-only";

import path from "node:path";

import { typeset, TypstError } from "@/lib/server/typst";

import type { RentalContractData, RentalContractRenderer } from "./types";

const TEMPLATE = path.join(process.cwd(), "src/lib/contract/rental/rental-contract.typ");

/** Distinct from TypstError so lib/contract/document.ts can tell a document that will not draw from a database that will not answer. */
export class RentalRenderError extends Error {}

export const renderRentalContract: RentalContractRenderer = async (data: RentalContractData) => {
  try {
    return await typeset(TEMPLATE, data, "the rental contract");
  } catch (e) {
    throw new RentalRenderError(
      e instanceof TypstError ? e.message : "the rental contract could not be typeset",
    );
  }
};
