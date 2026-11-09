// The intäktsräkning's typesetter: which template draws it. Stored documents are never re-rendered.
import "server-only";

import path from "node:path";

import { typeset } from "@/lib/server/typst";

import type { IncomeDocumentData } from "./document-data";

const TEMPLATE = path.join(process.cwd(), "src/lib/income/typst/intakt.typ");

export async function renderIncomePdf(data: IncomeDocumentData): Promise<Uint8Array> {
  return typeset(TEMPLATE, data, "the intäktsräkning");
}
