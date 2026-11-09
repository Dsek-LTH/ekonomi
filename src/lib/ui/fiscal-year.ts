// The räkenskapsår the reader has picked in the header: shared by the server,
// which reads it, and the picker, which writes it. See docs/navigation.md.
import { owningRoute } from "./routes";

/** Cookie holding the pick. A session cookie, so a new session opens on the current year. */
export const FISCAL_YEAR_COOKIE = "fiscal_year";

/** One of Fortnox's financial years, as the header offers it. */
export interface FiscalYear {
  /** Fortnox's own id for the year. What the cookie holds. */
  id: number;
  /** YYYY-MM-DD, both inclusive. */
  fromDate: string;
  toDate: string;
}

/** "2026", or "2025/26" for a broken year that straddles two. */
export function fiscalYearLabel(y: FiscalYear): string {
  const from = y.fromDate.slice(0, 4);
  const to = y.toDate.slice(0, 4);
  return from === to ? from : `${from}/${to.slice(2)}`;
}

/**
 * The pages the year narrows; elsewhere the picker is greyed out. The bokslut template under /closing is an exception,
 * and the Inkorg stays in because invoices made from it are made in the year.
 */
const APPLIES = [
  "/dashboard",
  "/expenses",
  "/bank",
  "/invoices",
  "/income",
  "/budget",
  "/ledger",
  "/closing",
];
const EXCEPT = ["/closing/template"];

export function fiscalYearApplies(path: string): boolean {
  return owningRoute(path, EXCEPT) === null && owningRoute(path, APPLIES) !== null;
}

/** Whether a `YYYY-MM-DD` (or ISO timestamp) falls in the year. For browser-side lists; the server uses lib/server/fiscal-year.ts. */
export function inFiscalYear(y: FiscalYear, date: string | null | undefined): boolean {
  if (!date) return false;
  const day = date.slice(0, 10);
  return day >= y.fromDate && day <= y.toDate;
}

/**
 * Whether a date being entered lies outside the picked year. False while there is no year or the date is incomplete.
 * Routes ask the same through lib/api/fiscal-year.ts.
 */
export function outsideFiscalYear(y: FiscalYear | null, date: string | null | undefined): boolean {
  if (!y || !date || !/^\d{4}-\d{2}-\d{2}/.test(date)) return false;
  return !inFiscalYear(y, date);
}

/** Keep a pick for the rest of the session. See FISCAL_YEAR_COOKIE. */
export function rememberFiscalYear(id: number): void {
  document.cookie = `${FISCAL_YEAR_COOKIE}=${id}; path=/; samesite=lax`;
}
