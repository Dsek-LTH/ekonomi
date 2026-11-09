// The intäktsräkning's typesetter: which template draws it, and nothing else.
//
// It used to be the intakt service's /v1/render, a LaTeX page drawn by
// pdflatex in another container. Rendering here means the document can change
// with the app that decides what it says, in one deploy. Documents already
// stored for booked days are bytes in object storage and are never re-rendered,
// so they stay exactly as they were.
import "server-only";

import path from "node:path";

import { typeset } from "@/lib/server/typst";

import type { IncomeDocumentData } from "./document-data";

const TEMPLATE = path.join(process.cwd(), "src/lib/income/typst/intakt.typ");

export async function renderIncomePdf(data: IncomeDocumentData): Promise<Uint8Array> {
  return typeset(TEMPLATE, data, "the intäktsräkning");
}
