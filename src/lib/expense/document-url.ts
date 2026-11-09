// Which documents an utlägg shows in the receipt panel, in order: the utläggsräkning, then every underlag in stapling order.
// The panel gets them as stored, not merged (merging is a printing operation, done for Fortnox in lib/server/pdf-merge.ts).
// Client-safe: its sibling document.ts is `server-only`. One function, so the screens never disagree.

/** The status whose cover page says nothing yet. See below. */
const DRAFT = "DRAFT";

interface ExpenseDocumentSubject {
  id: string;
  status: string;
  /** How it was paid. Only MILEAGE matters: it has no underlag, the journey is on the cover. */
  paymentType?: string;
  /** Every underlag attached, oldest first: the order they are stapled
   *  behind the cover for Fortnox. Empty on an utlägg with none. */
  receipts: { id: string; mimeType: string; filename: string }[];
}

/** One document in the panel: where it is and what it is. */
interface PanelDocument {
  src: string;
  mimeType: string;
  /** Alt text, for a document that is an image. */
  filename?: string;
  /** What the panel captions it, where it stacks more than one. */
  label?: string;
}

/** One underlag's caption: "Underlag 2 - kvitto_ica.jpg", numbered once there is more than one.
 * Shared with the wizard (new-client.tsx) so unsaved documents are captioned alike. */
export function underlagCaption(
  base: string,
  index: number,
  total: number,
  filename?: string,
): string {
  const numbered = total > 1 ? `${base} ${index + 1}` : base;
  return filename ? `${numbered} - ${filename}` : numbered;
}

/** The documents for the receipt panel: the utläggsräkning first, then every underlag, oldest first (the stapling order for Fortnox).
 * Empty with no receipt, so the empty panel can say a voucher is about to be booked with nothing behind it.
 * A draft gets its underlag and no cover (nothing attested, no reference yet, a render per open),
 * except a mileage draft, whose cover carries the journey. */
export function expenseDocuments(
  // Nullable because the booking screen holds its utlägg before narrowing away not-found.
  expense: ExpenseDocumentSubject | null | undefined,
  /** What to call the underlag when it is an image and needs alt text. */
  alt?: string,
  /** Captions for the two, passed in because this file is client-safe and knows no locales. Omitted, the stack goes uncaptioned. */
  labels?: { cover: string; underlag: string },
): PanelDocument[] {
  const coverLabel = labels?.cover;
  const underlagLabel = labels?.underlag;
  if (!expense) return [];

  // A milersättning has no underlag: its journey is a section of the cover. The one utlägg whose cover is shown as a draft.
  if (expense.paymentType === "MILEAGE") {
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

  // No cache key on the cover: it is the cover alone, and each receipt has its own id.
  return [
    {
      src: `/api/expenses/${expense.id}/document`,
      mimeType: "application/pdf",
      label: coverLabel,
    },
    ...underlag,
  ];
}
