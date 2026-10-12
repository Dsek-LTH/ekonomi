// Fortnox integration: OAuth2 (authorization-code flow) + the slice of the REST
// API we need to push booked vouchers (verifikationer) and attach receipts.
//
// Fortnox killed the legacy fixed-API-key auth in April 2025, so this is pure
// OAuth2. There are TWO kinds of authorisation, and which one a call uses is a
// deliberate decision:
//
//   service: a Fortnox service account, authorised once by a Fortnox system
//             administrator, tied to no person. Backs everything that READS
//             (ledger sync, accounts, cost centres) including the scheduled
//             job, so it must outlive individual employees. FortnoxConnection.
//   user    a bookkeeper's own Fortnox login, short-lived. Backs everything
//             that WRITES, so Fortnox stamps the voucher with their name rather
//             than the integration's. FortnoxUserSession.
//
// Fortnox scopes are not split into read/write. `bookkeeping` grants both, so
// this separation is enforced here in code, not by Fortnox. Tighten the service
// account's rights in Fortnox itself if you want it guaranteed.
//
// The access token lives ~1h; the refresh token is long-lived (~45 days) but
// ROTATES on every refresh, so each refresh persists the new pair.
import { prisma } from "@/lib/server/db";
import { decryptSecret, encryptSecret } from "@/lib/server/secrets";
import { VOUCHER_DESCRIPTION_MAX } from "./voucher-text";
import { FORTNOX_WRITE_TIMEOUT_MS } from "@/lib/domain/export-claim";

const AUTH_URL = "https://apps.fortnox.se/oauth-v1/auth";
const TOKEN_URL = "https://apps.fortnox.se/oauth-v1/token";
const API_BASE = "https://api.fortnox.se/3";

export type FortnoxAuthMode = "service" | "user";

// Scopes (exact Fortnox tokens). NB: "archive" is NOT a valid scope token,
// requesting it yields invalid_scope.
//
// The service account only ever reads, but `bookkeeping` is Fortnox's only
// ledger scope so it necessarily carries write rights too. The personal login
// additionally needs inbox + connectfile to upload a receipt and attach it to
// the voucher it just created.
const SERVICE_SCOPES = "bookkeeping costcenter companyinformation";
const USER_SCOPES = "bookkeeping inbox connectfile companyinformation";

const scopesFor = (mode: FortnoxAuthMode) =>
  mode === "service" ? SERVICE_SCOPES : USER_SCOPES;

// Refresh this many ms before the token actually expires, to avoid racing the
// clock on a slow request.
const EXPIRY_SKEW_MS = 60_000;

// How long a personal Fortnox login stays usable before the bookkeeper has to
// authenticate again, regardless of how much refresh-token life is left.
const USER_SESSION_MAX_MS = 8 * 60 * 60 * 1000;

export class FortnoxError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "FortnoxError";
  }
}

// Thrown when an operation needs a personal Fortnox login and there isn't a
// usable one. Callers should turn this into a prompt to log in, not an error
// toast, because nothing is wrong, the session just ran out. The message is a code
// under `errors.fortnox`, since it reaches a reader through fail().
export class FortnoxAuthRequiredError extends Error {
  constructor(message = "fortnox.loginRequired") {
    super(message);
    this.name = "FortnoxAuthRequiredError";
  }
}

// ── Config ────────────────────────────────────────────────────────

interface FortnoxConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function fortnoxConfigured(): boolean {
  return Boolean(
    process.env.FORTNOX_CLIENT_ID &&
      process.env.FORTNOX_CLIENT_SECRET &&
      process.env.FORTNOX_REDIRECT_URI,
  );
}

function getConfig(): FortnoxConfig {
  const clientId = process.env.FORTNOX_CLIENT_ID;
  const clientSecret = process.env.FORTNOX_CLIENT_SECRET;
  const redirectUri = process.env.FORTNOX_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new FortnoxError(
      "Fortnox is not configured (missing FORTNOX_CLIENT_ID/SECRET/REDIRECT_URI).",
    );
  }
  return { clientId, clientSecret, redirectUri };
}

// ── OAuth ─────────────────────────────────────────────────────────

// The URL the user's browser is sent to, to grant our app access to the Fortnox
// company. `state` is an anti-CSRF nonce we verify on the callback.
//
// `account_type=service` is what makes the difference between the two modes. It
// asks Fortnox to mint a service account, a synthetic Fortnox user named after
// the integration, which is why service-created vouchers read "Skapad av" and
// the integration's own name. Omitting it binds the token to the Fortnox user who authorises, and
// their name lands on the voucher instead.
//
// Both modes request offline access: the service connection refreshes forever,
// and the personal one refreshes silently inside its few-hour cap.
export function authorizeUrl(state: string, mode: FortnoxAuthMode): string {
  const { clientId, redirectUri } = getConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: scopesFor(mode),
    state,
    access_type: "offline", // required to receive a refresh token
    response_type: "code",
  });
  // Only a Fortnox system administrator can authorise this, and the app must
  // have service accounts enabled in the Fortnox Developer Portal.
  if (mode === "service") params.set("account_type", "service");
  return `${AUTH_URL}?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds
  token_type: string;
  scope: string;
}

function basicAuthHeader(): string {
  const { clientId, clientSecret } = getConfig();
  return "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
}

async function tokenRequest(body: URLSearchParams): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      json.error_description || json.error || `Token-förfrågan misslyckades (${res.status})`;
    throw new FortnoxError(String(msg), res.status);
  }
  return json as TokenResponse;
}

// Exchange the authorization code from the callback for the first token pair.
export async function exchangeCode(code: string): Promise<TokenResponse> {
  const { redirectUri } = getConfig();
  return tokenRequest(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  );
}

async function refreshTokens(refreshToken: string): Promise<TokenResponse> {
  return tokenRequest(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  );
}

// ── Service connection (read side, singleton) ─────────────────────

// The single stored service connection, if any. Treated as a singleton.
export function getConnection() {
  return prisma.fortnoxConnection.findFirst({ orderBy: { createdAt: "desc" } });
}

// Persist a freshly-obtained token pair as THE service connection, replacing
// any previous one (only one Fortnox company is ever connected).
export async function saveConnection(
  token: TokenResponse,
  opts: {
    connectedById?: string | null;
    companyName?: string | null;
    orgNumber?: string | null;
  },
) {
  const expiresAt = new Date(Date.now() + token.expires_in * 1000);
  return prisma.$transaction(async (tx) => {
    await tx.fortnoxConnection.deleteMany({});
    return tx.fortnoxConnection.create({
      data: {
        accessToken: encryptSecret(token.access_token),
        refreshToken: encryptSecret(token.refresh_token),
        expiresAt,
        scopes: token.scope || SERVICE_SCOPES,
        tokenType: token.token_type || "Bearer",
        companyName: opts.companyName ?? null,
        orgNumber: opts.orgNumber ?? null,
        connectedById: opts.connectedById ?? null,
      },
    });
  });
}

export async function disconnect(): Promise<void> {
  await prisma.fortnoxConnection.deleteMany({});
}

// Return a usable service access token, refreshing (and persisting the rotated
// pair) if the current one is at/near expiry. Throws if there's no connection.
//
// Everything that reads from Fortnox goes through here, including the scheduled
// sync. Never use it to write a voucher. See getUserToken.
//
// Note: refresh-token rotation means concurrent refreshes could race and
// invalidate each other. A scheduled sync running alongside an interactive one
// makes that a real possibility; this needs a lock around the refresh.
export async function getServiceToken(): Promise<string> {
  const conn = await getConnection();
  if (!conn) {
    throw new FortnoxError("fortnox.notConnected", 409);
  }
  if (conn.expiresAt.getTime() - EXPIRY_SKEW_MS > Date.now()) {
    return decryptSecret(conn.accessToken);
  }
  // Expired (or about to). Refresh and persist the rotated tokens.
  const token = await refreshTokens(decryptSecret(conn.refreshToken));
  await prisma.fortnoxConnection.update({
    where: { id: conn.id },
    data: {
      accessToken: encryptSecret(token.access_token),
      refreshToken: encryptSecret(token.refresh_token),
      expiresAt: new Date(Date.now() + token.expires_in * 1000),
      scopes: token.scope || conn.scopes,
    },
  });
  return token.access_token;
}

// ── Personal sessions (write side, one per user) ──────────────────

function getUserSession(userId: string) {
  return prisma.fortnoxUserSession.findUnique({ where: { userId } });
}

// Start (or restart) a bookkeeper's personal Fortnox session. The few-hour cap
// is set from now on every fresh login, and logging in again extends it.
export async function saveUserSession(
  userId: string,
  token: TokenResponse,
  opts: { fortnoxUserName?: string | null; fortnoxUserEmail?: string | null },
) {
  const data = {
    accessToken: encryptSecret(token.access_token),
    refreshToken: encryptSecret(token.refresh_token),
    tokenExpiresAt: new Date(Date.now() + token.expires_in * 1000),
    sessionExpiresAt: new Date(Date.now() + USER_SESSION_MAX_MS),
    scopes: token.scope || USER_SCOPES,
    fortnoxUserName: opts.fortnoxUserName ?? null,
    fortnoxUserEmail: opts.fortnoxUserEmail ?? null,
  };
  return prisma.fortnoxUserSession.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
}

export async function clearUserSession(userId: string): Promise<void> {
  await prisma.fortnoxUserSession.deleteMany({ where: { userId } });
}

// A usable personal access token for `userId`, or FortnoxAuthRequiredError if
// they need to log in to Fortnox again. Everything that writes to Fortnox goes
// through here so the voucher carries a person's name.
//
// The session cap is checked before the token expiry: a session past its cap is
// dead even if Fortnox would still refresh it happily.
export async function getUserToken(userId: string): Promise<string> {
  const session = await getUserSession(userId);
  if (!session) throw new FortnoxAuthRequiredError();

  if (session.sessionExpiresAt.getTime() <= Date.now()) {
    await clearUserSession(userId);
    throw new FortnoxAuthRequiredError("fortnox.loginExpired");
  }

  if (session.tokenExpiresAt.getTime() - EXPIRY_SKEW_MS > Date.now()) {
    return decryptSecret(session.accessToken);
  }

  // Inside the cap but the hour is up. Refresh silently. A refusal from
  // Fortnox (revoked access, rotated-away refresh token) is not recoverable,
  // so drop the session and make them log in.
  let token: TokenResponse;
  try {
    token = await refreshTokens(decryptSecret(session.refreshToken));
  } catch {
    await clearUserSession(userId);
    throw new FortnoxAuthRequiredError("fortnox.loginRefreshFailed");
  }

  await prisma.fortnoxUserSession.update({
    where: { userId },
    data: {
      accessToken: encryptSecret(token.access_token),
      refreshToken: encryptSecret(token.refresh_token),
      tokenExpiresAt: new Date(Date.now() + token.expires_in * 1000),
      scopes: token.scope || session.scopes,
      // sessionExpiresAt deliberately untouched: refreshing must not extend
      // the cap, only a fresh login does.
    },
  });
  return token.access_token;
}

// ── REST helpers ──────────────────────────────────────────────────

// Pull a human-readable message out of Fortnox's error envelope.
function fortnoxErrorMessage(json: unknown, status: number): string {
  const info = (json as { ErrorInformation?: { message?: string; Message?: string } })
    ?.ErrorInformation;
  return info?.message || info?.Message || `Fortnox-fel (${status})`;
}

async function fortnoxGet<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new FortnoxError(fortnoxErrorMessage(json, res.status), res.status);
  return json as T;
}

// Called off after FORTNOX_WRITE_TIMEOUT_MS. A write that hangs would otherwise
// hold an utlägg's export lock in SENT with no end, and the rule that lets a
// person resolve it relies on knowing the request is over. See
// lib/domain/export-claim.ts.
async function fortnoxPost<T>(path: string, token: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    signal: AbortSignal.timeout(FORTNOX_WRITE_TIMEOUT_MS),
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new FortnoxError(fortnoxErrorMessage(json, res.status), res.status);
  return json as T;
}

import { decodeCp437 } from "@/lib/fortnox/sie";

// ── Read side: financial years + SIE ledger export ────────────────

export interface FortnoxFinancialYear {
  id: number;
  fromDate: string; // YYYY-MM-DD
  toDate: string;
}

export async function listFinancialYears(token: string): Promise<FortnoxFinancialYear[]> {
  const data = await fortnoxGet<{
    FinancialYears?: { Id: number; FromDate: string; ToDate: string }[];
  }>("/financialyears", token);
  return (data.FinancialYears ?? []).map((y) => ({
    id: y.Id,
    fromDate: y.FromDate,
    toDate: y.ToDate,
  }));
}

/** The financial years a date range touches, oldest first. */
export function financialYearsFor(
  years: readonly FortnoxFinancialYear[],
  from: string,
  to: string,
): FortnoxFinancialYear[] {
  return years
    .filter((y) => y.fromDate <= to && y.toDate >= from)
    .sort((a, b) => a.fromDate.localeCompare(b.fromDate));
}

/** A voucher as the list endpoint describes it, enough to recognise one. */
interface FortnoxVoucher {
  series: string;
  number: number;
  /** YYYY-MM-DD. */
  date: string;
  description: string;
  /** Fortnox's financial-year ID, not a calendar year. */
  year: number | null;
}

/**
 * Every voucher whose transaction date falls in a range.
 *
 * Read with the service token and used to recognise work Fortnox already has:
 * a day's takings that were exported once and are about to be exported again
 * (see lib/income/duplicate.ts). Listing is the only way to ask: Fortnox can
 * fetch a voucher by series and number, but nothing looks one up by what it
 * says or when it is dated.
 *
 * `financialyear` matters more than it looks. Without it Fortnox answers from
 * the *current* year only, so a range that reaches into last year would come
 * back empty, which, for a duplicate check, is the failure that quietly says
 * "nothing there". Callers pass the year the range falls in; a range that
 * spans two is asked for twice.
 */
export async function listVouchers(
  token: string,
  range: { from: string; to: string; financialYearId?: number },
): Promise<FortnoxVoucher[]> {
  interface Page {
    Vouchers?: {
      VoucherSeries?: string;
      VoucherNumber?: number;
      TransactionDate?: string;
      Description?: string;
      Year?: number;
    }[];
    MetaInformation?: { "@TotalPages"?: number };
  }

  const year = range.financialYearId != null ? `&financialyear=${range.financialYearId}` : "";
  const out: FortnoxVoucher[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const data = await fortnoxGet<Page>(
      `/vouchers?fromdate=${range.from}&todate=${range.to}${year}&page=${page}`,
      token,
    );
    for (const v of data.Vouchers ?? []) {
      if (!v.VoucherSeries || v.VoucherNumber == null) continue;
      out.push({
        series: v.VoucherSeries,
        number: v.VoucherNumber,
        // Fortnox dates are date-only, but it has been known to answer with a
        // timestamp on some endpoints; the day is the part being compared.
        date: (v.TransactionDate ?? "").slice(0, 10),
        description: v.Description ?? "",
        year: v.Year ?? null,
      });
    }
    totalPages = data.MetaInformation?.["@TotalPages"] ?? 1;
    page++;
  } while (page <= totalPages);

  return out;
}

// Download the SIE type-4 (transactions) export for one financial year and
// decode it from CP437 to a normal JS string. This is the whole ledger for the
// year in a single request.
export async function fetchSie(token: string, financialYearId: number): Promise<string> {
  const res = await fetch(`${API_BASE}/sie/4?financialyear=${financialYearId}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new FortnoxError(fortnoxErrorMessage(json, res.status), res.status);
  }
  return decodeCp437(Buffer.from(await res.arrayBuffer()));
}

// ── Domain operations ─────────────────────────────────────────────

interface FortnoxCostCenter {
  code: string;
  description: string;
  active: boolean;
}

// List the company's cost centres (requires the `costcenter` scope). These are
// the only cost centres selectable when creating an expense.
export async function listCostCenters(token: string): Promise<FortnoxCostCenter[]> {
  const data = await fortnoxGet<{
    CostCenters?: { Code: string; Description?: string; Active?: boolean }[];
  }>("/costcenters", token);
  return (data.CostCenters ?? []).map((c) => ({
    code: c.Code,
    description: c.Description ?? c.Code,
    active: c.Active ?? true,
  }));
}

interface FortnoxAccount {
  number: string; // BAS account number, e.g. "6071"
  name: string;
  active: boolean;
  sru: string | null;
}

// The company's chart of accounts for one financial year. Unlike the SIE
// #KONTO records this also covers accounts that haven't been posted to yet,
// and it carries the active flag.
//
// /3/accounts is paginated (500 per page by default), so this walks every page
// a full BAS chart runs well past one.
export async function listAccounts(
  token: string,
  financialYearId: number,
): Promise<FortnoxAccount[]> {
  interface Page {
    Accounts?: { Number: number; Description?: string; Active?: boolean; SRU?: number }[];
    MetaInformation?: { "@TotalPages"?: number };
  }

  const out: FortnoxAccount[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const data = await fortnoxGet<Page>(
      `/accounts?financialyear=${financialYearId}&page=${page}`,
      token,
    );
    for (const a of data.Accounts ?? []) {
      out.push({
        number: String(a.Number),
        name: a.Description ?? String(a.Number),
        active: a.Active ?? true,
        sru: a.SRU != null ? String(a.SRU) : null,
      });
    }
    totalPages = data.MetaInformation?.["@TotalPages"] ?? 1;
    page++;
  } while (page <= totalPages);

  return out;
}

interface FortnoxCompany {
  name: string | null;
  orgNumber: string | null;
}

// Which Fortnox company a token actually belongs to. The name is cosmetic, but
// the organisation number is what a personal login is checked against. A
// bookkeeper with access to several Fortnox companies could otherwise authorise
// the wrong one and post the section's vouchers into someone else's books.
export async function getCompanyInfo(token: string): Promise<FortnoxCompany> {
  const data = await fortnoxGet<{
    CompanyInformation?: { CompanyName?: string; OrganizationNumber?: string };
  }>("/companyinformation", token);
  return {
    name: data.CompanyInformation?.CompanyName ?? null,
    orgNumber: data.CompanyInformation?.OrganizationNumber ?? null,
  };
}

interface FortnoxMe {
  name: string | null;
  email: string | null;
}

// Who Fortnox thinks the token belongs to. For a service account this is the
// integration; for a personal login it is the person, which is exactly the name
// that ends up on their vouchers.
export async function getMe(token: string): Promise<FortnoxMe> {
  try {
    const data = await fortnoxGet<{ MeInformation?: { Name?: string; Email?: string } }>(
      "/me",
      token,
    );
    return {
      name: data.MeInformation?.Name ?? null,
      email: data.MeInformation?.Email ?? null,
    };
  } catch {
    return { name: null, email: null }; // display only, never block login on it
  }
}

export interface VoucherRowInput {
  account: number;
  debit: number; // SEK (decimal)
  credit: number; // SEK (decimal)
  costCenter?: string; // Fortnox cost-centre code
  description?: string;
}

export interface CreatedVoucher {
  series: string;
  number: number;
  /** Fortnox's financial-year ID (a small integer, e.g. 10), NOT a calendar
   *  year, despite what Fortnox calls the field. Null if Fortnox didn't say:
   *  guessing a calendar year here would produce an ID that resolves to
   *  nothing. */
  year: number | null;
}

// POST a verifikation. Amounts are decimal SEK (Fortnox does not use öre).
export async function createVoucher(
  token: string,
  input: {
    series: string;
    date: string; // YYYY-MM-DD
    description: string;
    rows: VoucherRowInput[];
  },
): Promise<CreatedVoucher> {
  const VoucherRows = input.rows.map((r) => {
    const row: Record<string, unknown> = { Account: r.account };
    if (r.debit > 0) row.Debit = r.debit;
    if (r.credit > 0) row.Credit = r.credit;
    if (r.costCenter) row.CostCenter = r.costCenter;
    if (r.description) row.TransactionInformation = r.description.slice(0, 100);
    return row;
  });

  const data = await fortnoxPost<{
    Voucher?: { VoucherSeries?: string; VoucherNumber?: number; Year?: number };
  }>("/vouchers", token, {
    Voucher: {
      VoucherSeries: input.series,
      TransactionDate: input.date,
      Description: input.description.slice(0, VOUCHER_DESCRIPTION_MAX),
      VoucherRows,
    },
  });

  const v = data.Voucher;
  if (!v?.VoucherSeries || v.VoucherNumber == null) {
    throw new FortnoxError("Fortnox returnerade ingen verifikation.");
  }
  return { series: v.VoucherSeries, number: v.VoucherNumber, year: v.Year ?? null };
}

// Upload a receipt to the Fortnox inbox, returning the new File id.
export async function uploadInboxFile(
  token: string,
  bytes: Buffer,
  filename: string,
  contentType: string,
): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)], { type: contentType }), filename);
  // path=inbox_v targets the dedicated voucher inbox folder. Fortnox's own
  // voucher guide writes it "Inbox_v", but that capitalisation is rejected with
  // 400 "Försöker att skapa en fil under ogiltig sökväg". The lowercase form
  // is what their client libraries use.
  const res = await fetch(`${API_BASE}/inbox?path=inbox_v`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    body: form,
  });
  const json = (await res.json().catch(() => ({}))) as { File?: { Id?: string }; Id?: string };
  if (!res.ok) throw new FortnoxError(fortnoxErrorMessage(json, res.status), res.status);
  const id = json.File?.Id ?? json.Id;
  if (!id) throw new FortnoxError("Fortnox returnerade inget fil-id vid uppladdning.");
  return id;
}

// Attach an uploaded file to a created voucher. Series + number only identify a
// voucher within one financial year, so the year is passed as the
// `financialyear` query parameter. Note that this is Fortnox's financial-year
// ID (a small integer like 10), not a calendar year.
export async function connectFileToVoucher(
  token: string,
  fileId: string,
  series: string,
  number: number,
  financialYearId?: number,
): Promise<void> {
  const query = financialYearId != null ? `?financialyear=${financialYearId}` : "";
  await fortnoxPost(`/voucherfileconnections${query}`, token, {
    VoucherFileConnection: {
      FileId: fileId,
      VoucherSeries: series,
      VoucherNumber: number,
    },
  });
}
