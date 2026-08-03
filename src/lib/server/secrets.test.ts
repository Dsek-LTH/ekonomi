import { beforeAll, describe, expect, it } from "vitest";

// The key is derived from this on first use and then cached, so it has to be in
// place before the module is imported.
process.env.FORTNOX_TOKEN_KEY = "test-key-for-secrets-round-trip";

let encryptSecret: typeof import("./secrets").encryptSecret;
let decryptSecret: typeof import("./secrets").decryptSecret;

beforeAll(async () => {
  ({ encryptSecret, decryptSecret } = await import("./secrets"));
});

describe("encryptSecret / decryptSecret", () => {
  it("round-trips a token", () => {
    const token = "abc123-fortnox-access-token";
    expect(decryptSecret(encryptSecret(token))).toBe(token);
  });

  it("round-trips values with the delimiter in them", () => {
    // The stored form is colon-separated and the payload is base64, so a colon
    // in the plaintext must not confuse the split.
    const token = "a:b:c:d:e";
    expect(decryptSecret(encryptSecret(token))).toBe(token);
  });

  it("produces different ciphertext each time", () => {
    // A fresh nonce per encryption: two rows holding the same token must not
    // look the same at rest.
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("refuses a value it did not write", () => {
    // This used to be returned unchanged, which meant a plaintext or truncated
    // row was handed on as if it were a credential.
    expect(() => decryptSecret("plaintext-token")).toThrow(/fortnox.secretUnreadable/);
    expect(() => decryptSecret("")).toThrow(/fortnox.secretUnreadable/);
    expect(() => decryptSecret("v2:a:b:c")).toThrow(/fortnox.secretUnreadable/);
  });

  it("refuses ciphertext that has been tampered with", () => {
    // AES-GCM authenticates: a flipped byte fails the tag check rather than
    // decrypting to garbage.
    const sealed = encryptSecret("abc123-fortnox-access-token");
    const [prefix, iv, tag, ct] = sealed.split(":");
    const flipped = Buffer.from(ct, "base64");
    flipped[0] ^= 0xff;
    expect(() => decryptSecret([prefix, iv, tag, flipped.toString("base64")].join(":"))).toThrow();
  });
});
