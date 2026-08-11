// The intakt service: income reports from Zettle and Swish, and the PDFs that
// substantiate them.
//
// intakt is a separate container for one blunt reason — it renders its reports
// with pdflatex, and a TeX installation has no business in the image that
// serves every page of this app. It holds no state and no configuration: the
// routing table lives here (see ./config.ts) and is sent with every request, so
// there is one copy of it and it is the one an admin can edit.
//
// It also never talks to Fortnox. Booking is this app's job, because a voucher
// has to be written with the bookkeeper's own Fortnox login so Fortnox
// attributes it to them by name — and only the thing that knows who is signed
// in can do that. See lib/fortnox/index.ts.
//
// Fetching and rendering are deliberately separate calls. Between them the
// treasurer reviews what came back and sets cost centres, and reports they skip
// are never rendered at all. Fusing the two is what forced intakt's old CLI to
// write a manifest file and have it edited by hand.
import "server-only";

import type {
  IncomeFeeReportDto,
  IncomePaymentType,
  IncomeReportDto,
  IntaktConfig,
} from "./types";

/**
 * A failure from the service, carrying the status so a route can decide whether
 * it is the caller's fault or the service's.
 */
export class IntaktError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "IntaktError";
  }
}

/**
 * Thrown when the service is not configured at all. Callers should turn this
 * into "income import is switched off" rather than an error — running without
 * intakt is a supported way to run, the same way running without Fortnox is.
 */
export class IntaktNotConfiguredError extends Error {
  constructor(message = "intakt.notConfigured") {
    super(message);
    this.name = "IntaktNotConfiguredError";
  }
}

export function intaktConfigured(): boolean {
  return Boolean(process.env.INTAKT_URL && process.env.INTAKT_TOKEN);
}

function config(): { url: string; token: string } {
  const url = process.env.INTAKT_URL;
  const token = process.env.INTAKT_TOKEN;
  if (!url || !token) throw new IntaktNotConfiguredError();
  return { url: url.replace(/\/+$/, ""), token };
}

// Fetching a term of Zettle purchases means several paginated round trips on
// the far side, and a render queues behind however many are already running.
// Generous enough for both, short enough that a wedged service surfaces as an
// error rather than as a page that never loads.
const FETCH_TIMEOUT_MS = 120_000;
const RENDER_TIMEOUT_MS = 120_000;

/**
 * What the service said went wrong. Its errors are `{ "error": "..." }`, and
 * the ones worth passing on are about the *caller's* input — a malformed CSV,
 * a range that runs backwards — so they are surfaced rather than swallowed.
 */
async function errorFrom(res: Response): Promise<IntaktError> {
  let detail = "";
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string") detail = body.error;
  } catch {
    // Not JSON. The status is all there is to say.
  }
  return new IntaktError(detail || `intakt returned ${res.status}`, res.status);
}

async function postJSON<T>(path: string, body: unknown, timeoutMs: number): Promise<T> {
  const { url, token } = config();

  let res: Response;
  try {
    res = await fetch(`${url}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
      // Nothing here is cacheable: the same range fetched twice may legitimately
      // differ, and a cached PDF would be a stale document on a voucher.
      cache: "no-store",
    });
  } catch (e) {
    // A refused connection or a timeout — the service is down or wedged, which
    // is not the same as it rejecting the request.
    throw new IntaktError(e instanceof Error ? e.message : String(e));
  }

  if (!res.ok) throw await errorFrom(res);
  return (await res.json()) as T;
}

interface ReportsResponse {
  reports: IncomeReportDto[];
}
interface FeeReportsResponse {
  reports: IncomeFeeReportDto[];
}

/** Card takings for an inclusive date range, grouped one report per committee per day. */
export async function fetchZettleReports(
  from: string,
  to: string,
  cfg: IntaktConfig,
): Promise<IncomeReportDto[]> {
  const body = await postJSON<ReportsResponse>(
    "/v1/reports/zettle",
    { from, to, config: cfg },
    FETCH_TIMEOUT_MS,
  );
  return body.reports ?? [];
}

/** Zettle's own transaction fees for a range, grouped by day. */
export async function fetchFeeReports(
  from: string,
  to: string,
  cfg: IntaktConfig,
): Promise<IncomeFeeReportDto[]> {
  const body = await postJSON<FeeReportsResponse>(
    "/v1/reports/fees",
    { from, to, config: cfg },
    FETCH_TIMEOUT_MS,
  );
  return body.reports ?? [];
}

/**
 * The same grouping, from an uploaded Swish export rather than an API.
 *
 * The CSV is passed through as bytes and never decoded here: the export is
 * ISO-8859-1, and the service is the thing that knows that. Reading it as UTF-8
 * anywhere on the way would mangle every å, ä and ö in a product name — which
 * would show up as a committee that routes to the fallback rather than as an
 * error.
 */
export async function fetchSwishReports(
  from: string,
  to: string,
  csv: Uint8Array<ArrayBuffer>,
  filename: string,
  cfg: IntaktConfig,
): Promise<IncomeReportDto[]> {
  const { url, token } = config();

  const form = new FormData();
  form.append("config", JSON.stringify(cfg));
  form.append("from", from);
  form.append("to", to);
  form.append("file", new Blob([csv], { type: "text/csv" }), filename);

  let res: Response;
  try {
    res = await fetch(`${url}/v1/reports/swish`, {
      method: "POST",
      // No Content-Type: fetch sets it, with the multipart boundary.
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (e) {
    throw new IntaktError(e instanceof Error ? e.message : String(e));
  }

  if (!res.ok) throw await errorFrom(res);
  const body = (await res.json()) as ReportsResponse;
  return body.reports ?? [];
}

/**
 * Render one report to a PDF.
 *
 * The report is sent rather than referenced, because by now it is not the one
 * that was fetched — the cost centre may have been corrected, and the service
 * keeps no copy to render from.
 */
export async function renderReport(
  report: IncomeReportDto,
  cfg: IntaktConfig,
  paymentType: IncomePaymentType,
): Promise<Uint8Array> {
  return renderPdf({ config: cfg, paymentType, report: withoutKey(report) });
}

/** The same, for a fee report, which uses the other skeleton. */
export async function renderFeeReport(
  report: IncomeFeeReportDto,
  cfg: IntaktConfig,
): Promise<Uint8Array> {
  return renderPdf({ config: cfg, feeReport: withoutKey(report) });
}

/**
 * The report without its `key`.
 *
 * The key is ours — how a report is filed here — not part of what the service
 * defined. It rejects unknown fields, so sending it back would be a 400 rather
 * than something quietly ignored.
 */
function withoutKey<T extends { key: string }>(report: T): Omit<T, "key"> {
  const copy: Partial<T> = { ...report };
  delete copy.key;
  return copy as Omit<T, "key">;
}

async function renderPdf(body: unknown): Promise<Uint8Array> {
  const { url, token } = config();

  let res: Response;
  try {
    res = await fetch(`${url}/v1/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(RENDER_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (e) {
    throw new IntaktError(e instanceof Error ? e.message : String(e));
  }

  if (!res.ok) throw await errorFrom(res);
  return new Uint8Array(await res.arrayBuffer());
}
