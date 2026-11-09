// Which of a contract's files the panel shows, and in what order (client-safe, like
// lib/expense/document-url.ts). Signed copy leads, then the generated rendering, then
// attachments. The evidence log is deliberately left out (still in the documents list).

/** One document in the panel. Structural, so this file decides what the panel gets. */
interface PanelDocument {
  src: string;
  mimeType: string;
  filename?: string;
  label?: string;
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

    .sort((a, b) => ORDER.indexOf(a.role) - ORDER.indexOf(b.role))
    .map((f) => ({
      src: `/api/contracts/${contract.id}/files/${f.id}`,
      mimeType: f.mimeType,
      filename: f.filename,

      label: f.filename,
    }));
}
