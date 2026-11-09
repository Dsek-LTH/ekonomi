// The Gmail API as far as the levfaktura inkorg needs it (fetch and node:crypto, no googleapis; setup in
// docs/gmail-inbound.md). The mailbox is read with a refresh token from logging in as it once (OAuth,
// gmail.readonly, see api/gmail/connect). `watch` publishes changes to Pub/Sub (lasts seven days, renewed by
// cron), and Pub/Sub pushes to /api/inbound/gmail with a Google-signed OIDC token that verifyPushToken
// checks. Off unless every GMAIL_* variable is set.
import "server-only";

import { createPublicKey, createVerify, type JsonWebKey } from "node:crypto";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

export interface GmailConfig {
  mailbox: string;
  clientId: string;
  clientSecret: string;
  topic: string;
  pushAudience: string;
  pushServiceAccount: string;
  allowedDomain: string;
}

/** The configuration plus the stored login: what every Gmail call needs. */
export interface GmailMailbox extends GmailConfig {
  refreshToken: string;
}

/** The configuration, or null when the integration is off. */
export function gmailConfig(): GmailConfig | null {
  const e = process.env;
  const mailbox = e.GMAIL_MAILBOX;
  const clientId = e.GMAIL_OAUTH_CLIENT_ID;
  const clientSecret = e.GMAIL_OAUTH_CLIENT_SECRET;
  const topic = e.GMAIL_PUBSUB_TOPIC;
  const pushAudience = e.GMAIL_PUSH_AUDIENCE;
  const pushServiceAccount = e.GMAIL_PUSH_SERVICE_ACCOUNT;
  if (!mailbox || !clientId || !clientSecret || !topic || !pushAudience || !pushServiceAccount) {
    return null;
  }
  return {
    mailbox: mailbox.toLowerCase(),
    clientId,
    clientSecret,
    topic,
    pushAudience,
    pushServiceAccount: pushServiceAccount.toLowerCase(),
    allowedDomain: (e.INBOUND_ALLOWED_DOMAIN || "dsek.se").toLowerCase(),
  };
}

export class GmailError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    /** Google no longer accepts the refresh token: the mailbox has to be connected again. */
    readonly revoked = false,
  ) {
    super(message);
  }
}

/** Where to send the person connecting the mailbox. `prompt=consent` makes Google return a refresh token every time. */
export function authorizeUrl(c: GmailConfig, state: string, redirectUri: string): string {
  const q = new URLSearchParams({
    client_id: c.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    login_hint: c.mailbox,
    state,
  });
  return `${AUTH_URL}?${q}`;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const json = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !json.access_token) {
    throw new GmailError(
      `Google token exchange failed: ${json.error_description ?? json.error ?? res.status}`,
      res.status,
      json.error === "invalid_grant",
    );
  }
  return json;
}

// Access tokens by refresh token, renewed a minute before they run out. Keyed on the refresh token so a
// reconnect never reuses the old login's token.
const cache = new Map<string, { token: string; expiresAt: number }>();

const remember = (refreshToken: string, json: TokenResponse) => {
  cache.clear();
  cache.set(refreshToken, {
    token: json.access_token!,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  });
};

/** Trade the code from Google's redirect for a login. Throws unless Gmail read access was granted. */
export async function exchangeCode(
  c: GmailConfig,
  code: string,
  redirectUri: string,
): Promise<string> {
  const json = await tokenRequest({
    grant_type: "authorization_code",
    code,
    client_id: c.clientId,
    client_secret: c.clientSecret,
    redirect_uri: redirectUri,
  });
  if (!json.refresh_token) throw new GmailError("Google returned no refresh token");
  if (!json.scope?.split(" ").includes(SCOPE)) throw new GmailError("gmail.readonly not granted");
  remember(json.refresh_token, json);
  return json.refresh_token;
}

async function accessToken(m: GmailMailbox): Promise<string> {
  const hit = cache.get(m.refreshToken);
  if (hit && hit.expiresAt > Date.now() + 60_000) return hit.token;
  const json = await tokenRequest({
    grant_type: "refresh_token",
    refresh_token: m.refreshToken,
    client_id: m.clientId,
    client_secret: m.clientSecret,
  });
  remember(m.refreshToken, json);
  return json.access_token!;
}

/** Withdraw the login at Google. Best effort: the token is forgotten here either way. */
export async function revoke(refreshToken: string): Promise<void> {
  cache.delete(refreshToken);
  await fetch(REVOKE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: refreshToken }),
  }).catch(() => {});
}

async function call<T>(m: GmailMailbox, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${await accessToken(m)}`,
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  // A 204 (users.stop) has no body.
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) {
    throw new GmailError(
      `Gmail ${path.split("?")[0]}: ${json.error?.message ?? res.status}`,
      res.status,
    );
  }
  return json;
}

/** Which mailbox the login is for, and where its history stands. */
export const profile = (m: GmailMailbox) =>
  call<{ emailAddress: string; historyId: string }>(m, "/profile");

/** Stop publishing changes to Pub/Sub. */
export async function stopWatch(m: GmailMailbox): Promise<void> {
  await call(m, "/stop", { method: "POST" });
}

/** Ask Gmail to publish changes to the inbox. Returns where it starts from. */
export async function watch(m: GmailMailbox): Promise<{ historyId: string; expiration: Date }> {
  const r = await call<{ historyId: string; expiration: string }>(m, "/watch", {
    method: "POST",
    body: JSON.stringify({
      topicName: m.topic,
      labelIds: ["INBOX"],
      labelFilterBehavior: "INCLUDE",
    }),
  });
  return { historyId: r.historyId, expiration: new Date(Number(r.expiration)) };
}

/**
 * Every message added to the inbox since `startHistoryId`, oldest first, and the next history id. Throws a
 * GmailError with status 404 when the start is older than Gmail keeps history (about a week).
 */
export async function messagesAddedSince(
  m: GmailMailbox,
  startHistoryId: string,
): Promise<{ ids: string[]; historyId: string }> {
  const ids: string[] = [];
  let historyId = startHistoryId;
  let page: string | undefined;
  do {
    const q = new URLSearchParams({
      startHistoryId,
      historyTypes: "messageAdded",
      labelId: "INBOX",
      ...(page ? { pageToken: page } : {}),
    });
    const r = await call<{
      history?: { messagesAdded?: { message: { id: string } }[] }[];
      historyId: string;
      nextPageToken?: string;
    }>(m, `/history?${q}`);
    for (const h of r.history ?? []) for (const m of h.messagesAdded ?? []) ids.push(m.message.id);
    historyId = r.historyId;
    page = r.nextPageToken;
  } while (page);
  return { ids: [...new Set(ids)], historyId };
}

/** Inbox messages from the last `days` days, for when history has run out. */
export async function recentMessages(m: GmailMailbox, days: number): Promise<string[]> {
  const ids: string[] = [];
  let page: string | undefined;
  do {
    const q = new URLSearchParams({
      labelIds: "INBOX",
      q: `newer_than:${days}d`,
      maxResults: "100",
      ...(page ? { pageToken: page } : {}),
    });
    const r = await call<{ messages?: { id: string }[]; nextPageToken?: string }>(
      m,
      `/messages?${q}`,
    );
    for (const m of r.messages ?? []) ids.push(m.id);
    page = r.nextPageToken;
  } while (page);
  return ids.reverse();
}

/** One part of a message as Gmail's `full` format returns it. */
export interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailPart[];
}

export interface GmailMessage {
  id: string;
  internalDate?: string;
  labelIds?: string[];
  payload: GmailPart;
}

export const getMessage = (m: GmailMailbox, id: string) =>
  call<GmailMessage>(m, `/messages/${encodeURIComponent(id)}?format=full`);

export async function getAttachment(
  m: GmailMailbox,
  messageId: string,
  attachmentId: string,
): Promise<Buffer> {
  const r = await call<{ data: string }>(
    m,
    `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
  );
  return Buffer.from(r.data, "base64url");
}

let certs: { keys: Map<string, JsonWebKey>; fetchedAt: number } | null = null;

async function googleKey(kid: string): Promise<JsonWebKey | null> {
  // Refetched hourly, and at once for an unseen key id: Google rotates its signing keys.
  if (!certs || Date.now() - certs.fetchedAt > 3_600_000 || !certs.keys.has(kid)) {
    const res = await fetch(CERTS_URL);
    if (!res.ok) throw new GmailError(`Google certs: ${res.status}`, res.status);
    const json = (await res.json()) as { keys: (JsonWebKey & { kid: string })[] };
    certs = { keys: new Map(json.keys.map((k) => [k.kid, k])), fetchedAt: Date.now() };
  }
  return certs.keys.get(kid) ?? null;
}

/**
 * Whether a push request really comes from our Pub/Sub subscription (an OIDC token Google signed for our
 * endpoint). `keyFor` is injectable for tests.
 */
export async function verifyPushToken(
  c: GmailConfig,
  authorization: string | null,
  keyFor: (kid: string) => Promise<JsonWebKey | null> = googleKey,
  now = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return false;
  const [h, p, s] = token.split(".");
  if (!h || !p || !s) return false;

  let header: { alg?: string; kid?: string };
  let claims: {
    iss?: string;
    aud?: string;
    email?: string;
    email_verified?: boolean;
    exp?: number;
    iat?: number;
  };
  try {
    header = JSON.parse(Buffer.from(h, "base64url").toString("utf8"));
    claims = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
  } catch {
    return false;
  }
  if (header.alg !== "RS256" || !header.kid) return false;

  const jwk = await keyFor(header.kid);
  if (!jwk) return false;
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${h}.${p}`);
  if (!verifier.verify(createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(s, "base64url"))) {
    return false;
  }

  return (
    (claims.iss === "https://accounts.google.com" || claims.iss === "accounts.google.com") &&
    claims.aud === c.pushAudience &&
    claims.email?.toLowerCase() === c.pushServiceAccount &&
    claims.email_verified === true &&
    typeof claims.exp === "number" &&
    claims.exp > now
  );
}
