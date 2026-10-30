// The intakt service: what Zettle and a Swish export say was sold, and the PDFs
// that substantiate a booked day.
//
// intakt is a separate container for one blunt reason: it renders its reports
// with pdflatex, and a TeX installation has no business in the image that
// serves every page of this app. It holds no state and no configuration. It
// returns sales as they were rung up, and the app routes them (./routing.ts):
// which verksamhet a product is, and which account it is credited to, is
// decided here and only here. It used to be sent the whole routing table and
// route on its own, which put the routing in two places.
//
// It also never talks to Fortnox. Booking is this app's job, because a voucher
// has to be written with the bookkeeper's own Fortnox login so Fortnox
// attributes it to them by name, and only the thing that knows who is signed
// in can do that. See lib/fortnox/index.ts.
//
// Fetching and rendering are deliberately separate calls. Between them the app
// routes the sales and the treasurer reviews them, and days they skip are never
// rendered at all. The document is sent whole, so what is rendered is exactly
// what was booked.
import "server-only";

import type { IncomeDocument, SwishPayment, ZettleFee, ZettleSaleLine } from "./types";

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
 * into "income import is switched off" rather than an error. Running without
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
 * the ones worth passing on are about the *caller's* input (a malformed CSV,
 * a range that runs backwards) so they are surfaced rather than swallowed.
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
    // A refused connection or a timeout. The service is down or wedged, which
    // is not the same as it rejecting the request.
    throw new IntaktError(e instanceof Error ? e.message : String(e));
  }

  if (!res.ok) throw await errorFrom(res);
  return (await res.json()) as T;
}

/** Every product line Zettle sold in an inclusive range of Swedish days. */
export async function fetchZettleSales(from: string, to: string): Promise<ZettleSaleLine[]> {
  const body = await postJSON<{ lines?: ZettleSaleLine[] }>("/v1/zettle/sales", { from, to }, FETCH_TIMEOUT_MS);
  return body.lines ?? [];
}

/** Zettle's own payment fees in the same kind of range, as positive costs. */
export async function fetchZettleFees(from: string, to: string): Promise<ZettleFee[]> {
  const body = await postJSON<{ fees?: ZettleFee[] }>("/v1/zettle/fees", { from, to }, FETCH_TIMEOUT_MS);
  return body.fees ?? [];
}

/**
 * The payments in an uploaded Swish export that fall in the range.
 *
 * The CSV is passed through as bytes and never decoded here: the export is
 * ISO-8859-1, and the service is the thing that knows that. Reading it as UTF-8
 * anywhere on the way would mangle every å, ä and ö in a message, which would
 * show up as payments routed to the reserv rather than as an error.
 */
export async function fetchSwishPayments(
  from: string,
  to: string,
  csv: Uint8Array<ArrayBuffer>,
  filename: string,
): Promise<SwishPayment[]> {
  const { url, token } = config();

  const form = new FormData();
  form.append("from", from);
  form.append("to", to);
  form.append("file", new Blob([csv], { type: "text/csv" }), filename);

  let res: Response;
  try {
    res = await fetch(`${url}/v1/swish/payments`, {
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
  const body = (await res.json()) as { payments?: SwishPayment[] };
  return body.payments ?? [];
}

/** One finished day as PDF bytes. */
export async function renderDocument(document: IncomeDocument): Promise<Uint8Array> {
  const { url, token } = config();

  let res: Response;
  try {
    res = await fetch(`${url}/v1/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(document),
      signal: AbortSignal.timeout(RENDER_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (e) {
    throw new IntaktError(e instanceof Error ? e.message : String(e));
  }

  if (!res.ok) throw await errorFrom(res);
  return new Uint8Array(await res.arrayBuffer());
}
