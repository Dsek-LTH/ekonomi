// Fetches Zettle's purchases and fees (./zettle.ts turns them into lines). Uses a machine credential
// (ZETTLE_CLIENT_ID and ZETTLE_API_KEY, an "assertion" grant). Without them Zettle is off and
// Swish still works.

import "server-only";

import type { ZettleFee, ZettleSaleLine } from "./types";
import {
  normalizeFees,
  normalizePurchases,
  TX_PAYMENT,
  TX_PAYMENT_FEE,
  TX_PAYOUT,
  zettleRange,
  type ZettlePurchase,
  type ZettleTransaction,
} from "./zettle";

const TOKEN_URL = "https://oauth.zettle.com/token";
const PURCHASES_URL = "https://purchase.izettle.com/purchases/v2";
const TRANSACTIONS_URL = "https://finance.izettle.com/v2/accounts/LIQUID/transactions";
const ASSERTION_GRANT = "urn:ietf:params:oauth:grant-type:jwt-bearer";

const PURCHASE_PAGE = 1000;
const TRANSACTION_PAGE = 10_000;
/** Per request. A term of purchases is several pages, each well inside this. */
const TIMEOUT_MS = 30_000;
/** A runaway pager is a bug, not a busy term: a year is a few hundred pages at most. */
const MAX_PAGES = 1000;

/** Zettle is not set up in this environment. */
export class ZettleNotConfiguredError extends Error {
  constructor() {
    super("zettle.notConfigured");
    this.name = "ZettleNotConfiguredError";
  }
}

/** Zettle answered with something other than what was asked for. */
export class ZettleError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ZettleError";
  }
}

export function zettleConfigured(): boolean {
  return Boolean(process.env.ZETTLE_CLIENT_ID && process.env.ZETTLE_API_KEY);
}

function credentials(): { clientId: string; assertion: string } {
  const clientId = process.env.ZETTLE_CLIENT_ID;
  const assertion = process.env.ZETTLE_API_KEY;
  if (!clientId || !assertion) throw new ZettleNotConfiguredError();
  return { clientId, assertion };
}

/** The access token, cached per process until a minute before it expires. */
let cached: { token: string; expires: number; clientId: string } | null = null;

async function accessToken(): Promise<{ token: string; clientId: string }> {
  const { clientId, assertion } = credentials();
  if (cached && cached.clientId === clientId && Date.now() < cached.expires) {
    return { token: cached.token, clientId };
  }

  const res = await request(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "X-iZettle-Application-Id": clientId,
    },
    body: new URLSearchParams({ grant_type: ASSERTION_GRANT, client_id: clientId, assertion }),
  });
  if (!res.ok) throw await failure(res, "token");
  const body = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new ZettleError("the token response had no access_token");

  cached = {
    token: body.access_token,
    expires: Date.now() + ((body.expires_in ?? 0) - 60) * 1000,
    clientId,
  };
  return { token: cached.token, clientId };
}

/** fetch with a timeout, and a network failure said as Zettle's. */
async function request(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (e) {
    throw new ZettleError(`could not reach Zettle: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function failure(res: Response, what: string): Promise<ZettleError> {
  const text = (await res.text().catch(() => "")).slice(0, 300);
  return new ZettleError(
    `Zettle's ${what} endpoint answered ${res.status}${text ? `: ${text}` : ""}`,
    res.status,
  );
}

async function get<T>(url: URL, what: string): Promise<T> {
  const { token, clientId } = await accessToken();
  const res = await request(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "X-iZettle-Application-Id": clientId,
    },
  });
  // A token Zettle stopped accepting early: forget it so the next fetch signs in again.
  if (res.status === 401) cached = null;
  if (!res.ok) throw await failure(res, what);
  return (await res.json()) as T;
}

/** Every purchase between two range timestamps, page by page. */
async function purchases(start: string, end: string): Promise<ZettlePurchase[]> {
  const all: ZettlePurchase[] = [];
  let lastHash = "";
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(PURCHASES_URL);
    url.searchParams.set("limit", String(PURCHASE_PAGE));
    url.searchParams.set("descending", "true");
    url.searchParams.set("startDate", start);
    url.searchParams.set("endDate", end);
    if (lastHash) url.searchParams.set("lastPurchaseHash", lastHash);

    const body = await get<{ purchases?: ZettlePurchase[]; lastPurchaseHash?: string }>(
      url,
      "purchase",
    );
    const got = body.purchases ?? [];
    // The pages end with an empty one.
    if (got.length === 0) return all;
    all.push(...got);
    if (!body.lastPurchaseHash || body.lastPurchaseHash === lastHash) return all;
    lastHash = body.lastPurchaseHash;
  }
  throw new ZettleError("Zettle kept returning purchase pages; stopped to be safe");
}

/** Every finance transaction of the given types between two range timestamps. */
async function transactions(
  start: string,
  end: string,
  types: string[],
): Promise<ZettleTransaction[]> {
  const all: ZettleTransaction[] = [];
  for (let offset = 0, page = 0; page < MAX_PAGES; page++) {
    const url = new URL(TRANSACTIONS_URL);
    url.searchParams.set("limit", String(TRANSACTION_PAGE));
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("start", start);
    url.searchParams.set("end", end);
    for (const t of types) url.searchParams.append("includeTransactionType", t);

    const got = await get<ZettleTransaction[]>(url, "finance");
    all.push(...got);
    if (got.length < TRANSACTION_PAGE) return all;
    offset += got.length;
  }
  throw new ZettleError("Zettle kept returning transaction pages; stopped to be safe");
}

/** Every product line Zettle sold on the days `from` to `to`, both inclusive. */
export async function fetchZettleSales(from: string, to: string): Promise<ZettleSaleLine[]> {
  const { start, end } = zettleRange(from, to);
  return normalizePurchases(await purchases(start, end));
}

/** Zettle's own fees on the days `from` to `to`, both inclusive. */
export async function fetchZettleFees(from: string, to: string): Promise<ZettleFee[]> {
  const { start, end } = zettleRange(from, to);
  // Payments and payouts are dropped by normalizeFees.
  return normalizeFees(await transactions(start, end, [TX_PAYMENT, TX_PAYMENT_FEE, TX_PAYOUT]));
}
