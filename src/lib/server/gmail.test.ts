import { createSign, generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GmailError,
  authorizeUrl,
  exchangeCode,
  gmailConfig,
  profile,
  verifyPushToken,
} from "./gmail";

// The push token Google signs (checked with a key pair made here), and the mailbox login (Google mocked).

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const jwk = publicKey.export({ format: "jwk" });

const config = {
  mailbox: "fakturor@dsek.se",
  clientId: "client.apps.googleusercontent.com",
  clientSecret: "secret",
  topic: "projects/ekonomi/topics/inkorg",
  pushAudience: "https://ekonomi.dsek.se/api/inbound/gmail",
  pushServiceAccount: "pubsub-push@ekonomi.iam.gserviceaccount.com",
  allowedDomain: "dsek.se",
};

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");

function token(claims: object, header: object = { alg: "RS256", kid: "k1", typ: "JWT" }) {
  const signer = createSign("RSA-SHA256");
  signer.update(`${b64(header)}.${b64(claims)}`);
  return `${b64(header)}.${b64(claims)}.${signer.sign(pem).toString("base64url")}`;
}

const now = 1_800_000_000;
const good = {
  iss: "https://accounts.google.com",
  aud: config.pushAudience,
  email: config.pushServiceAccount,
  email_verified: true,
  iat: now - 10,
  exp: now + 3590,
};
const keyFor = async (kid: string) => (kid === "k1" ? jwk : null);
const check = (auth: string | null) => verifyPushToken(config, auth, keyFor, now);

describe("verifyPushToken", () => {
  it("accepts Google's token for our endpoint and push account", async () => {
    expect(await check(`Bearer ${token(good)}`)).toBe(true);
  });

  it("refuses no token at all", async () => {
    expect(await check(null)).toBe(false);
    expect(await check("Basic abc")).toBe(false);
  });

  it.each([
    ["another audience", { aud: "https://evil.example/api" }],
    ["another service account", { email: "someone@evil.iam.gserviceaccount.com" }],
    ["an unverified email", { email_verified: false }],
    ["another issuer", { iss: "https://evil.example" }],
    ["an expired token", { exp: now - 1 }],
  ])("refuses %s", async (_label, change) => {
    expect(await check(`Bearer ${token({ ...good, ...change })}`)).toBe(false);
  });

  it("refuses a token signed with some other key", async () => {
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
    const h = b64({ alg: "RS256", kid: "k1" });
    const p = b64(good);
    const signer = createSign("RSA-SHA256");
    signer.update(`${h}.${p}`);
    expect(await check(`Bearer ${h}.${p}.${signer.sign(other).toString("base64url")}`)).toBe(false);
  });

  it("refuses a token whose claims were changed after signing", async () => {
    const [h, , s] = token(good).split(".");
    expect(await check(`Bearer ${h}.${b64({ ...good, aud: "x" })}.${s}`)).toBe(false);
  });

  it("refuses an unknown key id and an algorithm other than RS256", async () => {
    expect(await check(`Bearer ${token(good, { alg: "RS256", kid: "k2" })}`)).toBe(false);
    expect(await check(`Bearer ${token(good, { alg: "none", kid: "k1" })}`)).toBe(false);
  });
});

describe("the login", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const reply = (status: number, body: object) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const form = (call: number) =>
    Object.fromEntries(new URLSearchParams(String(fetchMock.mock.calls[call][1].body)));

  it("asks Google for offline, read-only access to the mailbox", () => {
    const url = new URL(
      authorizeUrl(config, "nonce1", "https://ekonomi.dsek.se/api/gmail/callback"),
    );
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: config.clientId,
      redirect_uri: "https://ekonomi.dsek.se/api/gmail/callback",
      scope: "https://www.googleapis.com/auth/gmail.readonly",
      access_type: "offline",
      prompt: "consent",
      login_hint: "fakturor@dsek.se",
      state: "nonce1",
    });
  });

  it("trades the code for a refresh token, then reads the mailbox without asking again", async () => {
    fetchMock.mockResolvedValueOnce(
      reply(200, {
        access_token: "at1",
        refresh_token: "rt1",
        expires_in: 3600,
        scope: "https://www.googleapis.com/auth/gmail.readonly",
      }),
    );
    fetchMock.mockResolvedValueOnce(
      reply(200, { emailAddress: "fakturor@dsek.se", historyId: "5" }),
    );
    const refreshToken = await exchangeCode(config, "code1", "https://x/cb");
    expect(refreshToken).toBe("rt1");
    expect(form(0)).toMatchObject({ grant_type: "authorization_code", code: "code1" });
    expect(await profile({ ...config, refreshToken })).toEqual({
      emailAddress: "fakturor@dsek.se",
      historyId: "5",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe("Bearer at1");
  });

  it("refuses a login that did not grant Gmail read access", async () => {
    fetchMock.mockResolvedValueOnce(
      reply(200, { access_token: "at", refresh_token: "rt", scope: "openid email" }),
    );
    await expect(exchangeCode(config, "c", "https://x/cb")).rejects.toThrow("not granted");
  });

  it("gets a new access token from the refresh token", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { access_token: "at2", expires_in: 3600 }));
    fetchMock.mockResolvedValueOnce(
      reply(200, { emailAddress: "fakturor@dsek.se", historyId: "6" }),
    );
    await profile({ ...config, refreshToken: "rt2" });
    expect(form(0)).toEqual({
      grant_type: "refresh_token",
      refresh_token: "rt2",
      client_id: config.clientId,
      client_secret: config.clientSecret,
    });
  });

  it("says when Google no longer accepts the refresh token", async () => {
    fetchMock.mockResolvedValueOnce(
      reply(400, {
        error: "invalid_grant",
        error_description: "Token has been expired or revoked.",
      }),
    );
    const err = await profile({ ...config, refreshToken: "rt3" }).catch((e) => e);
    expect(err).toBeInstanceOf(GmailError);
    expect(err.revoked).toBe(true);
  });

  it("does not take another failure for a revoked login", async () => {
    fetchMock.mockResolvedValueOnce(reply(500, { error: "internal" }));
    const err = await profile({ ...config, refreshToken: "rt4" }).catch((e) => e);
    expect(err.revoked).toBe(false);
  });
});

describe("gmailConfig", () => {
  it("is off until every variable is set", () => {
    const keep = { ...process.env };
    try {
      for (const k of Object.keys(process.env)) if (k.startsWith("GMAIL_")) delete process.env[k];
      expect(gmailConfig()).toBeNull();
      Object.assign(process.env, {
        GMAIL_MAILBOX: "Fakturor@dsek.se",
        GMAIL_OAUTH_CLIENT_ID: config.clientId,
        GMAIL_OAUTH_CLIENT_SECRET: config.clientSecret,
        GMAIL_PUBSUB_TOPIC: config.topic,
        GMAIL_PUSH_AUDIENCE: config.pushAudience,
      });
      expect(gmailConfig()).toBeNull();
      process.env.GMAIL_PUSH_SERVICE_ACCOUNT = config.pushServiceAccount;
      const c = gmailConfig();
      expect(c?.mailbox).toBe("fakturor@dsek.se");
      expect(c?.allowedDomain).toBe("dsek.se");
    } finally {
      process.env = keep;
    }
  });
});
