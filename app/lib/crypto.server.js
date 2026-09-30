import crypto from "node:crypto";

/**
 * AES-256-GCM helpers for encrypting merchant-supplied API keys at rest.
 * We never store a merchant's Gemini/Claude key in plaintext — only the
 * ciphertext, in ShopAiSettings.encryptedApiKey.
 *
 * ENCRYPTION_KEY must be a 32-byte key, base64-encoded (44 chars incl.
 * padding). Generate one with:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 * Never commit this value — set it in your hosting provider's env vars,
 * same as SHOPIFY_API_SECRET. Losing/rotating it makes every previously
 * stored key undecryptable, so merchants would need to re-enter theirs.
 */
function getKey() {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "ENCRYPTION_KEY is not set. Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\" and add it to your .env",
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      `ENCRYPTION_KEY must decode to exactly 32 bytes (got ${key.length}). Regenerate with node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    );
  }
  return key;
}

const ALGO = "aes-256-gcm";

/** Encrypts plaintext, returning "iv.authTag.ciphertext" (all base64). */
export function encrypt(plaintext) {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(
    ".",
  );
}

/** Decrypts a string produced by encrypt(). Throws if the key is wrong or the value was tampered with. */
export function decrypt(payload) {
  const key = getKey();
  const [ivB64, authTagB64, ciphertextB64] = payload.split(".");
  if (!ivB64 || !authTagB64 || !ciphertextB64) {
    throw new Error("Malformed encrypted payload");
  }
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextB64, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}
