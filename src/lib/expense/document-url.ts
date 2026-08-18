// Which documents an utlägg stands in the receipt panel, and in what order.
//
// Two of them, kept apart: the utläggsräkning — the cover page naming who
// attested what — and the underlag itself, with the panel's pager moving
// between them.
//
// They used to arrive as one merged PDF, and merging is still what goes to
// Fortnox (lib/server/pdf-merge.ts). But merging is a *printing* operation: a
// photographed receipt has to be laid onto an A4 sheet to become a PDF page,
// and that sheet is white — so on screen every photographed receipt came
// framed in paper, in a panel that is otherwise the reader's own theme, at
// whatever size the fit-to-page arithmetic left it. Reading a receipt is not
// printing it. The viewer is handed the two documents as they were stored.
//
// Client-safe on purpose — its server-side sibling (document.ts) is
// `server-only`, and this is the half the panels need. One function rather
// than the same conditions written out on the detail page and the booking
// screen, because the two disagreeing would mean the same utlägg showing a
// different document depending on which screen you opened it from.

/** The status whose cover page says nothing yet. See below. */
const DRAFT = "DRAFT";

export interface ExpenseDocumentSubject {
  id: string;
  status: string;
  /** Absent when the utlägg has no underlag. The DTOs spell that `undefined`
   *  and the database `null`; neither caller should have to care which. */
  receiptId?: string | null;
  /** How the underlag is stored — `image/jpeg`, `image/png` or
   *  `application/pdf`. A photo when the DTO doesn't carry it, which is what
   *  nearly every receipt is. */
  receiptMimeType?: string | null;
}

/** One document in the panel: where it is and what it is. Structural on
 *  purpose, so this file — which knows nothing about the viewer — can be the
 *  one place that decides what the panel gets. */
export interface PanelDocument {
  src: string;
  mimeType: string;
  /** Alt text, for a document that is an image. */
  filename?: string;
}

/**
 * The documents to stand in the receipt panel, in reading order: the cover,
 * then the underlag it fronts — the order they were stapled in when this was
 * one file, so paging forward lands where turning the page used to.
 *
 * Empty in one case, and deliberately. No receipt: the utlägg still has a
 * cover, but showing it alone would fill the panel with a document and take
 * away the one thing an empty panel exists to say — that a voucher is about to
 * be booked with nothing behind it.
 *
 * A draft gets its underlag and no cover. A cover is a statement about what was
 * attested, and nothing has been; it would be a page of dashes under a
 * reference the utlägg has not been given yet (that happens at submission), and
 * it would cost a render of the typesetter every time somebody opened their own
 * half-finished utlägg.
 */
export function expenseDocuments(
  // Nullable, because the booking screen holds its utlägg before it has
  // narrowed away the not-found case and would otherwise have to compute this
  // twice, once inside each branch.
  expense: ExpenseDocumentSubject | null | undefined,
  /** What to call the underlag when it is an image and needs alt text. */
  alt?: string,
): PanelDocument[] {
  if (!expense?.receiptId) return [];

  const underlag: PanelDocument = {
    src: `/api/receipts/${expense.receiptId}`,
    mimeType: expense.receiptMimeType ?? "image/jpeg",
    filename: alt,
  };
  if (expense.status === DRAFT) return [underlag];

  // No cache key on the cover any more: it is the cover alone, so a replaced
  // receipt cannot change it. The receipt is addressed by its own id, which is
  // a new URL when it is replaced.
  return [
    { src: `/api/expenses/${expense.id}/document`, mimeType: "application/pdf" },
    underlag,
  ];
}
