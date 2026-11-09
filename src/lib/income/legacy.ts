// Reports booked before the per-day voucher (2026-11): one verksamhet's day (`resultUnitId` set)
// or a day of Zettle's fees (ZETTLE_FEE). Booked or exported ones are kept as they are and cannot
// be reopened. To correct one, delete it and fetch the day again.

interface ReportShape {
  source: string;
  resultUnitId: string | null;
}

export const isLegacyReport = (r: ReportShape) =>
  r.source === "ZETTLE_FEE" || r.resultUnitId !== null;
