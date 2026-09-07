// Which of a contract's files the reader is shown, and in what order.
//
// The same job lib/expense/document-url.ts does for an utlägg, and client-safe
// for the same reason: the panel runs in the browser, and the decision has to
// be made in one place so two screens showing the same contract cannot show
// different documents.
//
// The order is what a reader wants first, not what the archive holds first. A
// signed contract is what the parties actually agreed to, so it leads; the
// rendering that preceded it is behind it, worth keeping in the pager because
// "what did we send them" is a real question when a signature is disputed.
// Attachments come last: a photograph of the gear is context, not the
// agreement. The evidence log is deliberately not here at all, because it is a
// provider's audit file rather than something to read beside the work, and it
// is one click away in the documents list.

/** One document in the panel: where it is and what it is. Structural on
 *  purpose, so this file (which knows nothing about the viewer) can be the one
 *  place that decides what the panel gets. */
interface PanelDocument {
  src: string;
  mimeType: string;
  filename?: string;
}

interface ContractFileLike {
  id: string;
  role: string;
  filename: string;
  mimeType: string;
}

interface ContractLike {
  id: string;
  files: ContractFileLike[];
}

/** Reading order, best first. A role missing from this list is not shown. */
const ORDER: readonly string[] = ["SIGNED", "GENERATED", "ORIGINAL", "ATTACHMENT"];

export function contractDocuments(contract: ContractLike): PanelDocument[] {
  return contract.files
    .filter((f) => ORDER.includes(f.role))
    .slice()
    // Stable within a role, so two attachments keep the order the archive
    // returned them in (newest first) rather than an order nobody chose.
    .sort((a, b) => ORDER.indexOf(a.role) - ORDER.indexOf(b.role))
    .map((f) => ({
      src: `/api/contracts/${contract.id}/files/${f.id}`,
      mimeType: f.mimeType,
      filename: f.filename,
    }));
}
