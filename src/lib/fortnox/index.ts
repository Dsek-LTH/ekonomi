// Fortnox OAuth2 and the REST slice used to push vouchers and supplier invoices.
//
// Two authorisations. service: a Fortnox service account tied to no person, backs all
// reads and the nightly sync (FortnoxConnection). user: a bookkeeper's own login, backs
// all writes so Fortnox stamps their name (FortnoxUserSession). Fortnox scopes are not
// split read/write, so the separation is enforced here in code.
//
// Refresh tokens rotate on every refresh, so each refresh persists the new pair.
import { prisma } from "@/lib/server/db";
import { decryptSecret, encryptSecret } from "@/lib/server/secrets";
import { VOUCHER_DESCRIPTION_MAX } from "./voucher-text";
import { FORTNOX_WRITE_TIMEOUT_MS } from "@/lib/domain/export-claim";

const AUTH_URL = "https://apps.fortnox.se/oauth-v1/auth";
const TOKEN_URL = "https://apps.fortnox.se/oauth-v1/token";
const API_BASE = "https://api.fortnox.se/3";

export type FortnoxAuthMode = "service" | "user";

// Exact Fortnox scope tokens: "archive" is not valid (invalid_scope).
// The service account only reads, but `bookkeeping` is the only ledger scope and carries
// write rights too. A connection or personal login made before `project`, `supplier` or
// `supplierinvoice` were added must reconnect. Suppliers are only added in Fortnox.
const SERVICE_SCOPES = "bookkeeping costcenter project companyinformation supplier";
const USER_SCOPES = "bookkeeping inbox connectfile companyinformation supplierinvoice supplier";

const scopesFor = (mode: FortnoxAuthMode) => (mode === "service" ? SERVICE_SCOPES : USER_SCOPES);

// Refresh this many ms before expiry to avoid racing the clock.
const EXPIRY_SKEW_MS = 60_000;

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

// Needs a personal Fortnox login and none is usable. Callers should prompt to log in, not
// show an error. The message is a code under `errors.fortnox` (it reaches fail()).
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

// `state` is an anti-CSRF nonce verified on the callback. `account_type=service` mints a
// synthetic service account (vouchers read "Skapad av" the integration); without it the
// token binds to the authorising user and their name lands on the voucher.
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
  // Only a Fortnox system administrator can authorise this, with service accounts enabled
  // in the Developer Portal.
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

export function getConnection() {
  return prisma.fortnoxConnection.findFirst({ orderBy: { createdAt: "desc" } });
}

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
    // Keep a chosen series across a reconnect to the same company.
    const previous = await tx.fortnoxConnection.findFirst({
      select: { voucherSeries: true, orgNumber: true },
    });
    const voucherSeries =
      previous && previous.orgNumber === (opts.orgNumber ?? null) ? previous.voucherSeries : null;
    await tx.fortnoxConnection.deleteMany({});
    return tx.fortnoxConnection.create({
      data: {
        voucherSeries,
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

// A usable service token, refreshing if near expiry. Reads only, never for writing
// vouchers (see getUserToken). The refresh runs under a lock: Fortnox rotates the refresh
// token, so concurrent refreshes would store a stale pair and kill the connection.
export async function getServiceToken(): Promise<string> {
  const conn = await getConnection();
  if (!conn) {
    throw new FortnoxError("fortnox.notConnected", 409);
  }
  if (isFresh(conn.expiresAt)) return decryptSecret(conn.accessToken);

  const outcome = await prisma.$transaction(
    async (tx): Promise<{ token: string } | { refused: FortnoxError }> => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SERVICE_REFRESH_LOCK}::bigint)`;
      const current = await tx.fortnoxConnection.findUnique({ where: { id: conn.id } });
      if (!current) throw new FortnoxError("fortnox.notConnected", 409);
      if (isFresh(current.expiresAt)) return { token: decryptSecret(current.accessToken) };

      let token: TokenResponse;
      try {
        token = await refreshTokens(decryptSecret(current.refreshToken));
      } catch (e) {
        // Fortnox refused (no retry helps): returned out of the transaction so recording it
        // is not rolled back. Other errors (timeout, 5xx) are not recorded.
        if (
          e instanceof FortnoxError &&
          e.status !== undefined &&
          e.status >= 400 &&
          e.status < 500
        ) {
          return { refused: e };
        }
        throw e;
      }
      await tx.fortnoxConnection.update({
        where: { id: current.id },
        data: {
          accessToken: encryptSecret(token.access_token),
          refreshToken: encryptSecret(token.refresh_token),
          expiresAt: new Date(Date.now() + token.expires_in * 1000),
          scopes: token.scope || current.scopes,
          refreshFailedAt: null,
          refreshError: null,
        },
      });
      return { token: token.access_token };
    },
    // Raised above Prisma's 5s default: the Fortnox request runs inside the transaction.
    { timeout: 30_000, maxWait: 30_000 },
  );
  if ("token" in outcome) return outcome.token;

  await prisma.fortnoxConnection.updateMany({
    where: { id: conn.id },
    data: { refreshFailedAt: new Date(), refreshError: outcome.refused.message },
  });
  throw outcome.refused;
}

/** Any number, as long as nothing else takes the same advisory lock. */
const SERVICE_REFRESH_LOCK = 724_501;

const isFresh = (expiresAt: Date) => expiresAt.getTime() - EXPIRY_SKEW_MS > Date.now();

// ── Personal sessions (write side, one per user) ──────────────────

function getUserSession(userId: string) {
  return prisma.fortnoxUserSession.findUnique({ where: { userId } });
}

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

// A usable personal token, or FortnoxAuthRequiredError. All writes go through here. The
// session cap is checked before token expiry.
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

  // Refresh silently. A refusal from Fortnox is unrecoverable, so drop the session.
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
      // Refreshing must not extend sessionExpiresAt, only a fresh login does.
    },
  });
  return token.access_token;
}

// ── REST helpers ──────────────────────────────────────────────────

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

// Aborts after FORTNOX_WRITE_TIMEOUT_MS so a hung write cannot hold an export lock in SENT
// (see lib/domain/export-claim.ts).
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

export function financialYearsFor(
  years: readonly FortnoxFinancialYear[],
  from: string,
  to: string,
): FortnoxFinancialYear[] {
  return years
    .filter((y) => y.fromDate <= to && y.toDate >= from)
    .sort((a, b) => a.fromDate.localeCompare(b.fromDate));
}

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
 * Vouchers dated in a range, read with the service token (used by lib/income/duplicate.ts).
 * Always pass `financialyear`: without it Fortnox searches only the current year and returns
 * empty. A range spanning two years is asked for twice.
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
        // Some endpoints answer with a timestamp; compare the day.
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

// SIE type 4 export for one financial year, decoded from CP437.
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

interface FortnoxProject {
  number: string;
  description: string;
  active: boolean;
}

// Inactive projects are still listed so existing voucher lines resolve. Paginated.
export async function listProjects(token: string): Promise<FortnoxProject[]> {
  interface Page {
    Projects?: { ProjectNumber: string; Description?: string; Status?: string }[];
    MetaInformation?: { "@TotalPages"?: number };
  }

  const out: FortnoxProject[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const data = await fortnoxGet<Page>(`/projects?page=${page}`, token);
    for (const p of data.Projects ?? []) {
      out.push({
        number: String(p.ProjectNumber),
        description: p.Description || String(p.ProjectNumber),
        active: p.Status !== "COMPLETED",
      });
    }
    totalPages = data.MetaInformation?.["@TotalPages"] ?? 1;
    page++;
  } while (page <= totalPages);

  return out;
}

interface FortnoxAccount {
  number: string; // BAS account number, e.g. "6071"
  name: string;
  active: boolean;
  sru: string | null;
}

// Chart of accounts for a financial year, including accounts not yet posted to, with the
// active flag. Paginated (500 per page).
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

// The organisation number is what a personal login is checked against, so a bookkeeper
// cannot authorise the wrong company.
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
  project?: string; // Fortnox project number
  description?: string;
}

export interface CreatedVoucher {
  series: string;
  number: number;
  /** Fortnox's financial-year ID (e.g. 10), not a calendar year. Null if not given. */
  year: number | null;
}

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
    if (r.project) row.Project = r.project;
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

// Upload to the Fortnox inbox, returning the File id. Voucher folder by default, inbox_s
// for a levfaktura.
export async function uploadInboxFile(
  token: string,
  bytes: Buffer,
  filename: string,
  contentType: string,
  folder: "inbox_v" | "inbox_s" = "inbox_v",
): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)], { type: contentType }), filename);
  // Lowercase: Fortnox rejects "Inbox_v" (400) despite its own guide.
  const res = await fetch(`${API_BASE}/inbox?path=${folder}`, {
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

// ── Suppliers and supplier invoices ───────────────────────────────

export interface FortnoxSupplier {
  number: string;
  name: string;
  orgNo: string | null;
  bankgiro: string | null;
  plusgiro: string | null;
  active: boolean;
}

// Every page of the register; the picker filters in the browser.
export async function listSuppliers(token: string): Promise<FortnoxSupplier[]> {
  const out: FortnoxSupplier[] = [];
  for (let page = 1; ; page++) {
    const data = await fortnoxGet<{
      Suppliers?: {
        SupplierNumber?: string;
        Name?: string;
        OrganisationNumber?: string;
        BG?: string;
        PG?: string;
        Active?: boolean;
      }[];
      MetaInformation?: { "@TotalPages"?: number };
    }>(`/suppliers?limit=500&page=${page}`, token);
    for (const s of data.Suppliers ?? []) {
      if (!s.SupplierNumber) continue;
      out.push({
        number: s.SupplierNumber,
        name: s.Name ?? s.SupplierNumber,
        orgNo: s.OrganisationNumber || null,
        bankgiro: s.BG || null,
        plusgiro: s.PG || null,
        active: s.Active !== false,
      });
    }
    if (page >= (data.MetaInformation?.["@TotalPages"] ?? 1)) return out;
  }
}

export async function getSupplier(token: string, number: string): Promise<FortnoxSupplier> {
  const data = await fortnoxGet<{
    Supplier?: {
      SupplierNumber?: string;
      Name?: string;
      OrganisationNumber?: string;
      BG?: string;
      PG?: string;
      Active?: boolean;
    };
  }>(`/suppliers/${encodeURIComponent(number)}`, token);
  const s = data.Supplier;
  if (!s?.SupplierNumber) throw new FortnoxError("Leverantören finns inte i Fortnox.", 404);
  return {
    number: s.SupplierNumber,
    name: s.Name ?? s.SupplierNumber,
    orgNo: s.OrganisationNumber || null,
    bankgiro: s.BG || null,
    plusgiro: s.PG || null,
    active: s.Active !== false,
  };
}

export interface SupplierInvoiceInput {
  supplierNumber: string;
  invoiceNumber: string;
  invoiceDate: string; // YYYY-MM-DD
  dueDate: string;
  total: number; // SEK
  ocr?: string | null;
  yourReference?: string | null;
  ourReference?: string | null;
  comments?: string | null;
  rows: {
    account: number;
    debit: number;
    credit: number;
    costCenter?: string;
    project?: string;
    text?: string;
  }[];
  payableAccount: number;
  /** Öresutjämning, SEK, signed. */
  rounding?: { account: number; amount: number };
}

/** Make an unbooked supplier invoice, returning its GivenNumber. Rows go as attested, no VAT. */
export async function createSupplierInvoice(
  token: string,
  input: SupplierInvoiceInput,
): Promise<string> {
  const rows: Record<string, unknown>[] = input.rows.map((r) => ({
    Account: r.account,
    ...(r.debit ? { Debit: r.debit } : { Credit: r.credit }),
    ...(r.costCenter && { CostCenter: r.costCenter }),
    ...(r.project && { Project: r.project }),
    ...(r.text && { TransactionInformation: r.text.slice(0, 100) }),
  }));
  if (input.rounding) {
    const { account, amount } = input.rounding;
    rows.push(
      amount > 0 ? { Account: account, Debit: amount } : { Account: account, Credit: -amount },
    );
  }
  rows.push({ Account: input.payableAccount, Code: "TOT", Credit: input.total });

  const data = await fortnoxPost<{ SupplierInvoice?: { GivenNumber?: string | number } }>(
    "/supplierinvoices",
    token,
    {
      SupplierInvoice: {
        SupplierNumber: input.supplierNumber,
        InvoiceNumber: input.invoiceNumber,
        InvoiceDate: input.invoiceDate,
        DueDate: input.dueDate,
        Total: input.total.toFixed(2),
        VAT: "0",
        ...(input.rounding && { RoundOffValue: input.rounding.amount.toFixed(2) }),
        ...(input.ocr && { OCR: input.ocr }),
        ...(input.yourReference && { YourReference: input.yourReference.slice(0, 50) }),
        ...(input.ourReference && { OurReference: input.ourReference.slice(0, 50) }),
        ...(input.comments && { Comments: input.comments.slice(0, 1000) }),
        SupplierInvoiceRows: rows,
      },
    },
  );
  const given = data.SupplierInvoice?.GivenNumber;
  if (given == null || given === "")
    throw new FortnoxError("Fortnox returnerade ingen leverantörsfaktura.");
  return String(given);
}

export async function connectFileToSupplierInvoice(
  token: string,
  fileId: string,
  givenNumber: string,
): Promise<void> {
  await fortnoxPost("/supplierinvoicefileconnections", token, {
    SupplierInvoiceFileConnection: { FileId: fileId, SupplierInvoiceNumber: givenNumber },
  });
}

// Series + number identify a voucher only within a financial year, so pass Fortnox's
// financial-year ID (not a calendar year) as `financialyear`.
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
