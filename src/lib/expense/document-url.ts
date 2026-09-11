// Which documents an utlägg stands in the receipt panel, and in what order.
//
// The utläggsräkning (the cover page naming who attested what), then every
// underlag behind it, in the order they are stapled in. The panel stacks them
// into one scroll, captioned, so the reader meets all of them.
//
// They used to arrive as one merged PDF, and merging is still what goes to
// Fortnox (lib/server/pdf-merge.ts). But merging is a *printing* operation: a
// photographed receipt has to be laid onto an A4 sheet to become a PDF page,
// and that sheet is white, so on screen every photographed receipt came
// framed in paper, in a panel that is otherwise the reader's own theme, at
// whatever size the fit-to-page arithmetic left it. Reading a receipt is not
// printing it. The viewer is handed the documents as they were stored.
//
// Client-safe on purpose. Its server-side sibling (document.ts) is
// `server-only`, and this is the half the panels need. One function rather
// than the same conditions written out on the detail page and the booking
// screen, because the two disagreeing would mean the same utlägg showing a
// different document depending on which screen you opened it from.

/** The status whose cover page says nothing yet. See below. */
const DRAFT = "DRAFT";

interface ExpenseDocumentSubject {
  id: string;
  status: string;
  /**
   * How it was paid. Only MILEAGE matters here, and only because it has no
   * underlag to stand behind the cover: the journey is printed on the cover
   * itself, so there is one document rather than several.
   */
  paymentType?: string;
  /** Every underlag attached, oldest first: the order they are stapled
   *  behind the cover for Fortnox. Empty on an utlägg with none. */
  receipts: { id: string; mimeType: string; filename: string }[];
}

/** One document in the panel: where it is and what it is. Structural on
 *  purpose, so this file (which knows nothing about the viewer) can be the
 *  one place that decides what the panel gets. */
interface PanelDocument {
  src: string;
  mimeType: string;
  /** Alt text, for a document that is an image. */
  filename?: string;
  /** What the panel captions it, where it stacks more than one. */
  label?: string;
}

/**
 * One underlag's caption: "Underlag" (numbered, once there is more than one
 * to tell apart) and the file it was uploaded as, where the caller has a name
 * for it. "Underlag 2 – kvitto_ica.jpg" over a bare "Underlag 2": a number
 * alone still leaves a reader to open the document to find out which
 * purchase it was.
 *
 * Exported so the wizard (new-client.tsx), which builds its own document list
 * for what hasn't been saved yet, captions its documents the same way this
 * does for a saved one; a submitter should not learn a new word for the same
 * thing between filling the utlägg in and reading it back.
 */
export function underlagCaption(
  base: string,
  index: number,
  total: number,
  filename?: string,
): string {
  const numbered = total > 1 ? `${base} ${index + 1}` : base;
  // The en dash the house style reserves for joining a label to what it
  // names on one line (see AGENTS.md).
  return filename ? `${numbered} – ${filename}` : numbered;
}

/**
 * The documents to stand in the receipt panel: the utläggsräkning first, then
 * every underlag behind it, oldest first. A milersättning is the one utlägg
 * that returns a single document; see below.
 *
 * The order is the one they are stapled in for Fortnox (lib/server/
 * pdf-merge.ts): the utläggsräkning is the front of the document, and a reader
 * scrolling through what the section will actually file should meet it the way
 * the section will.
 *
 * There is no landing page any more, and that is the point. The panel used to
 * show one document at a time and open on the underlag, on the reasoning that
 * the underlag is what nobody else has seen and the cover is generated from
 * data already on screen. The reasoning was sound and the effect was that the
 * cover became invisible: it sat behind a pager arrow with nothing saying it
 * was there, and the people it was written for forgot it existed. Stacked and
 * captioned, all of them are simply on the page, and the one you meet first is
 * the one the section files first.
 *
 * Numbered only where there is more than one underlag to tell apart: most
 * utlägg have exactly one, and captioning it "Underlag 1" would be counting
 * something nobody asked about. Named regardless, once there is a caption at
 * all: the file it was uploaded as is worth knowing whether or not there is a
 * second one to distinguish it from. See underlagCaption.
 *
 * Empty in one case, and deliberately. No receipt: the utlägg still has a
 * cover, but showing it alone would fill the panel with a document and take
 * away the one thing an empty panel exists to say: that a voucher is about to
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
  /**
   * What the panel captions the two, where it shows both.
   *
   * Passed in rather than written here: this file is client-safe and knows
   * nothing about locales, and the two words are the caller's own translations.
   * Omitted, the stack goes uncaptioned, which is what it did before.
   */
  labels?: { cover: string; underlag: string },
): PanelDocument[] {
  const coverLabel = labels?.cover;
  const underlagLabel = labels?.underlag;
  if (!expense) return [];

  // A milersättning has no underlag of its own: there is nothing to photograph
  // about driving your own car, so the journey it rests on is a section of the
  // utläggsräkning rather than a document behind it. One document, and the only
  // kind of utlägg whose cover is shown while it is still a draft. That page
  // is the only place the journey can be read.
  if (expense.paymentType === "MILEAGE") {
    // One document, so no caption: there is nothing to tell it apart from.
    return [{ src: `/api/expenses/${expense.id}/document`, mimeType: "application/pdf" }];
  }

  if (expense.receipts.length === 0) return [];

  const underlag: PanelDocument[] = expense.receipts.map((r, i) => ({
    src: `/api/receipts/${r.id}`,
    mimeType: r.mimeType || "image/jpeg",
    filename: alt,
    label: underlagLabel
      ? underlagCaption(underlagLabel, i, expense.receipts.length, r.filename)
      : undefined,
  }));
  if (expense.status === DRAFT) return underlag;

  // No cache key on the cover any more: it is the cover alone, so an added or
  // removed receipt cannot change it. Each receipt is addressed by its own
  // id, which is a new URL for a newly added one.
  return [
    {
      src: `/api/expenses/${expense.id}/document`,
      mimeType: "application/pdf",
      label: coverLabel,
    },
    ...underlag,
  ];
}
