// Symmetric encryption for third-party credentials we have to store at rest
// (Fortnox OAuth tokens). AES-256-GCM, so tampering is detected rather than
// silently decrypting to garbage.
//
// The key comes from FORTNOX_TOKEN_KEY when set, otherwise it is derived from
// AUTH_SECRET, which means rotating AUTH_SECRET makes every stored token
// undecryptable and forces a reconnect. That is an acceptable failure mode
// (reconnecting is a two-click flow) and it keeps local dev zero-config.
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

const PREFIX = "v1"; // ciphertext marker, anything else is not ours to read
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // GCM standard nonce length
// Named after the project's old name (utlagg) and kept that way on purpose.
// The salt is part of the key, so changing it makes every stored token unreadable.
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

/**
 * Decrypt a stored secret.
 *
 * Anything not in the `v1:iv:tag:ciphertext` shape was not written by this
 * module, and there is nothing sensible to do with it. This used to hand such a
 * value back unchanged, for tokens stored before encryption existed, which
 * also meant a truncated or corrupted row was passed on as though it were a
 * valid credential, and the failure surfaced much later as an opaque 401 from
 * the far end. Refusing here says what is actually wrong; for a Fortnox token
 * the fix is to reconnect, which is a two-click flow.
 */
export function decryptSecret(stored: string): string {
  const parts = stored.split(":");
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    throw new Error(
      "fortnox.secretUnreadable",
    );
  }

  const [, iv, tag, ct] = parts;
  const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ct, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
