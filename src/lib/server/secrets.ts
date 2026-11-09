// Symmetric encryption (AES-256-GCM, so tampering is detected) for stored third-party credentials. The key
// is FORTNOX_TOKEN_KEY, else derived from AUTH_SECRET (rotating it forces a Fortnox reconnect).
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

const PREFIX = "v1"; // ciphertext marker, anything else is not ours to read
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // GCM standard nonce length
// Named after the project's old name (utlagg) on purpose: the salt is part of the key.
const SALT = "utlagg.fortnox.tokens.v1";

let cachedKey: Buffer | null = null;

function key(): Buffer {
  if (cachedKey) return cachedKey;
  const material = process.env.FORTNOX_TOKEN_KEY || process.env.AUTH_SECRET;
  if (!material) {
    throw new Error(
      "Kan inte kryptera Fortnox-tokens: varken FORTNOX_TOKEN_KEY eller AUTH_SECRET är satt.",
    );
  }
  cachedKey = scryptSync(material, SALT, 32);
  return cachedKey;
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [
    PREFIX,
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    ct.toString("base64"),
  ].join(":");
}

/** Decrypt a stored secret. Anything not in the `v1:iv:tag:ciphertext` shape is refused (for a Fortnox token: reconnect). */
export function decryptSecret(stored: string): string {
  const parts = stored.split(":");
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    throw new Error("fortnox.secretUnreadable");
  }

  const [, iv, tag, ct] = parts;
  const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64")), decipher.final()]).toString(
    "utf8",
  );
}
