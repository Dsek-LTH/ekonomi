// The Gmail API as far as the levfaktura inkorg needs it (fetch and node:crypto, no googleapis; setup in
// docs/gmail-inbound.md). A service account with domain-wide delegation reads the mailbox via a signed JWT,
// `watch` publishes changes to Pub/Sub (lasts seven days, renewed by cron), and Pub/Sub pushes to
// /api/inbound/gmail with a Google-signed OIDC token that verifyPushToken checks. Off unless every GMAIL_*
// variable is set.
import "server-only";

import { createPublicKey, createSign, createVerify, type JsonWebKey } from "node:crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

interface GmailConfig {
  mailbox: string;
  serviceAccount: string;
  privateKey: string;
  topic: string;
  pushAudience: string;
  pushServiceAccount: string;
  allowedDomain: string;
}

/** The configuration, or null when the integration is off. */
export function gmailConfig(): GmailConfig | null {
  const e = process.env;
  const mailbox = e.GMAIL_MAILBOX;
  const serviceAccount = e.GMAIL_SERVICE_ACCOUNT_EMAIL;
  const privateKey = e.GMAIL_SERVICE_ACCOUNT_KEY;
  const topic = e.GMAIL_PUBSUB_TOPIC;
  const pushAudience = e.GMAIL_PUSH_AUDIENCE;
  const pushServiceAccount = e.GMAIL_PUSH_SERVICE_ACCOUNT;
  if (
    !mailbox ||
    !serviceAccount ||
    !privateKey ||
    !topic ||
    !pushAudience ||
    !pushServiceAccount
  ) {
    return null;
  }
  return {
    mailbox,
    serviceAccount,
    // A PEM in an environment variable arrives with its newlines written as \n.
    privateKey: privateKey.replace(/\\n/g, "\n"),
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
  ) {
    super(message);
  }
}

const b64url = (data: Buffer | string) => Buffer.from(data).toString("base64url");

/** A JWT signed with the service account's key, for the token exchange. */
export function serviceAccountAssertion(
  c: GmailConfig,
  now = Math.floor(Date.now() / 1000),
): string {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: c.serviceAccount,
      sub: c.mailbox,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  return `${header}.${claims}.${b64url(signer.sign(c.privateKey))}`;
}

// One token per process, renewed a minute before it runs out.
let cached: { token: string; expiresAt: number } | null = null;

async function accessToken(c: GmailConfig): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: serviceAccountAssertion(c),
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error_description?: string;
    error?: string;
  };
  if (!res.ok || !json.access_token) {
    throw new GmailError(
      `Google token exchange failed: ${json.error_description ?? json.error ?? res.status}`,
      res.status,
    );
  }
  cached = { token: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 };
  return cached.token;
}

async function call<T>(c: GmailConfig, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${await accessToken(c)}`,
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) {
    throw new GmailError(
      `Gmail ${path.split("?")[0]}: ${json.error?.message ?? res.status}`,
      res.status,
    );
  }
  return json;
}

/** Ask Gmail to publish changes to the inbox. Returns where it starts from. */
export async function watch(c: GmailConfig): Promise<{ historyId: string; expiration: Date }> {
  const r = await call<{ historyId: string; expiration: string }>(c, "/watch", {
    method: "POST",
    body: JSON.stringify({
      topicName: c.topic,
      labelIds: ["INBOX"],
      labelFilterBehavior: "INCLUDE",
    }),
  });
  return { historyId: r.historyId, expiration: new Date(Number(r.expiration)) };
}

/** The mailbox's current history id, for starting from now. */
export async function currentHistoryId(c: GmailConfig): Promise<string> {
  return (await call<{ historyId: string }>(c, "/profile")).historyId;
}

/**
 * Every message added to the inbox since `startHistoryId`, oldest first, and the next history id. Throws a
 * GmailError with status 404 when the start is older than Gmail keeps history (about a week).
 */
export async function messagesAddedSince(
  c: GmailConfig,
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
    }>(c, `/history?${q}`);
    for (const h of r.history ?? []) for (const m of h.messagesAdded ?? []) ids.push(m.message.id);
    historyId = r.historyId;
    page = r.nextPageToken;
  } while (page);
  return { ids: [...new Set(ids)], historyId };
}

/** Inbox messages from the last `days` days, for when history has run out. */
export async function recentMessages(c: GmailConfig, days: number): Promise<string[]> {
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
      c,
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

export const getMessage = (c: GmailConfig, id: string) =>
  call<GmailMessage>(c, `/messages/${encodeURIComponent(id)}?format=full`);

export async function getAttachment(
  c: GmailConfig,
  messageId: string,
  attachmentId: string,
): Promise<Buffer> {
  const r = await call<{ data: string }>(
    c,
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
