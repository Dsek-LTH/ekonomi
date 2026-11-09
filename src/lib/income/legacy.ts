// Reports booked before the per-day voucher (2026-11).
//
// Until then a report was one verksamhet's day (`resultUnitId` set, one cost
// centre on the report), or a day of Zettle's fees on its own (ZETTLE_FEE).
// Those that were booked or exported are kept exactly as they are: their
// verifikation is in the ledger, their document is stored bytes, and Fortnox
// has the voucher. Nothing here re-books one. They are listed, read and
// unexported like any other, and the one thing refused is reopening, since a
// reopened one would be a draft in a shape the booking screen no longer has.
// To correct one, delete it and fetch the day again.

interface ReportShape {
  source: string;
  resultUnitId: string | null;
}

export const isLegacyReport = (r: ReportShape) =>
  r.source === "ZETTLE_FEE" || r.resultUnitId !== null;
