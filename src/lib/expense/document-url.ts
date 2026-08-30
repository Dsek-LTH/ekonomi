// Which documents an utlägg stands in the receipt panel, and in what order.
//
// Two of them, kept apart: the utläggsräkning — the cover page naming who
// attested what — and the underlag behind it, with the panel's pager moving
// between them. They are in the order they are stapled in; the panel opens on
// the second. See `expenseDocuments` for why those are not the same decision.
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
  /**
   * How it was paid. Only MILEAGE matters here, and only because it has no
   * underlag to stand behind the cover: the journey is printed on the cover
   * itself, so there is one document rather than two.
   */
  paymentType?: string;
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
  /** The one the panel opens on, whatever its place in the order. */
  defaultOpen?: boolean;
}

/**
 * The documents to stand in the receipt panel: the utläggsräkning first, then
 * the underlag it fronts — and the panel opens on the underlag. A milersättning
 * is the one utlägg that returns a single document; see below.
 *
 * Order and landing page are two different questions, and this is the case
 * where they part.
 *
 * The order is the one the two are stapled in for Fortnox (lib/server/
 * pdf-merge.ts): the utläggsräkning is the front of the document, and a reader
 * paging through what the section will actually file should meet it the way
 * the section will. This used to be the other way round, with the underlag
 * first, precisely so that the panel would open on it — which conflated the two
 * questions and put the pages in an order nothing else in the app uses.
 *
 * The landing page is the underlag all the same. That is the document nobody
 * else has seen, and the one every screen using this panel is asking a question
 * about; the cover is generated from data already on screen beside it. So it is
 * marked rather than moved.
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
 * half-finished utlägg. A mileage draft is the exception, and has to be: its
 * cover carries the journey, and a panel that showed nothing until submission
 * would leave the submitter no way to check what they had typed.
 */
export function expenseDocuments(
  // Nullable, because the booking screen holds its utlägg before it has
  // narrowed away the not-found case and would otherwise have to compute this
  // twice, once inside each branch.
  expense: ExpenseDocumentSubject | null | undefined,
  /** What to call the underlag when it is an image and needs alt text. */
  alt?: string,
): PanelDocument[] {
  if (!expense) return [];

  // A milersättning has no underlag of its own: there is nothing to photograph
  // about driving your own car, so the journey it rests on is a section of the
  // utläggsräkning rather than a document behind it. One document, and the only
  // kind of utlägg whose cover is shown while it is still a draft — that page
  // is the only place the journey can be read.
  if (expense.paymentType === "MILEAGE") {
    return [{ src: `/api/expenses/${expense.id}/document`, mimeType: "application/pdf" }];
  }

  if (!expense.receiptId) return [];

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
    { ...underlag, defaultOpen: true },
  ];
}
