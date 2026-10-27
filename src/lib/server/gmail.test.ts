import { createSign, createVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { serviceAccountAssertion, verifyPushToken, gmailConfig } from "./gmail";

// The two signed tokens the integration deals in: the one the app signs to
// read the mailbox, and the one Google signs to say a push is genuine. Both
// checked with a key pair made here, so nothing reaches Google.

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const jwk = publicKey.export({ format: "jwk" });

const config = {
  mailbox: "fakturor@dsek.se",
  serviceAccount: "inkorg@ekonomi.iam.gserviceaccount.com",
  privateKey: pem,
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

describe("serviceAccountAssertion", () => {
  it("is signed by the service account, for the mailbox, read-only", () => {
    const jwt = serviceAccountAssertion(config, now);
    const [h, p, s] = jwt.split(".");
    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${h}.${p}`);
    expect(verifier.verify(publicKey, Buffer.from(s, "base64url"))).toBe(true);
    expect(JSON.parse(Buffer.from(p, "base64url").toString())).toEqual({
      iss: config.serviceAccount,
      sub: "fakturor@dsek.se",
      scope: "https://www.googleapis.com/auth/gmail.readonly",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    });
  });
});

describe("gmailConfig", () => {
  it("is off until every variable is set, and reads a key with escaped newlines", () => {
    const keep = { ...process.env };
    try {
      for (const k of Object.keys(process.env)) if (k.startsWith("GMAIL_")) delete process.env[k];
      expect(gmailConfig()).toBeNull();
      Object.assign(process.env, {
        GMAIL_MAILBOX: config.mailbox,
        GMAIL_SERVICE_ACCOUNT_EMAIL: config.serviceAccount,
        GMAIL_SERVICE_ACCOUNT_KEY: "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----",
        GMAIL_PUBSUB_TOPIC: config.topic,
        GMAIL_PUSH_AUDIENCE: config.pushAudience,
      });
      expect(gmailConfig()).toBeNull();
      process.env.GMAIL_PUSH_SERVICE_ACCOUNT = config.pushServiceAccount;
      const c = gmailConfig();
      expect(c?.privateKey).toBe("-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----");
      expect(c?.allowedDomain).toBe("dsek.se");
    } finally {
      process.env = keep;
    }
  });
});
