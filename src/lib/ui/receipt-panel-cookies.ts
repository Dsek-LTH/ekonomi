// The receipt panel's stored shape, read by the app layout on the server so the first paint is right, and written by
// the panel in the browser (components/receipt/receipt-panel.tsx). A plain module: the server cannot call into the
// panel's "use client" file.

export const RECEIPT_COLLAPSED_COOKIE = "receipt_collapsed";
export const RECEIPT_WIDTH_COOKIE = "receipt_width";

export const RECEIPT_MIN_WIDTH = 360;
export const RECEIPT_MAX_FRACTION = 0.7;
/** Half the page by default. The width is kept as a share of the frame, so it fits any screen it is opened on. */
export const RECEIPT_DEFAULT_WIDTH = 0.5;

/** The stored share, or the default for none (or an old width in pixels, from before it was a share). */
export function receiptWidthFrom(cookie: string | undefined): number {
  const n = Number(cookie);
  return Number.isFinite(n) && n > 0 && n <= RECEIPT_MAX_FRACTION ? n : RECEIPT_DEFAULT_WIDTH;
}
