// The räkenskapsår the reader has picked in the header: shared by the server,
// which reads it, and the picker, which writes it. See docs/navigation.md.
import { owningRoute } from "./routes";

/**
 * The cookie the pick is kept in. A session cookie, with no max-age: the
 * year stays put while somebody works, and a new session opens on the
 * current year again, which is the default.
 */
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
 * The pages the year narrows. Everywhere else the picker stands greyed out, so
 * the header keeps its shape and the reader can see the year does not apply.
 * The bokslut template is under /closing but is the same every year, so it is
 * listed as an exception.
 */
const APPLIES = ["/dashboard", "/expenses", "/bank", "/invoices", "/income", "/budget", "/ledger", "/closing"];
const EXCEPT = ["/closing/template"];

export function fiscalYearApplies(path: string): boolean {
  return owningRoute(path, EXCEPT) === null && owningRoute(path, APPLIES) !== null;
}

/**
 * Whether a `YYYY-MM-DD` (or an ISO timestamp) falls in the year. For the
 * lists cut in the browser; the server ones ask the database with the same
 * bounds (see lib/server/fiscal-year.ts).
 */
export function inFiscalYear(y: FiscalYear, date: string | null | undefined): boolean {
  if (!date) return false;
  const day = date.slice(0, 10);
  return day >= y.fromDate && day <= y.toDate;
}

/** Keep a pick for the rest of the session. See FISCAL_YEAR_COOKIE. */
export function rememberFiscalYear(id: number): void {
  document.cookie = `${FISCAL_YEAR_COOKIE}=${id}; path=/; samesite=lax`;
}
