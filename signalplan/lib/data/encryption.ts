import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

/**
 * AES-256-GCM encryption for BYOK model keys in workspace_settings. The key
 * comes from SETTINGS_ENCRYPTION_KEY (base64 or hex 32 bytes; any other input
 * is hashed to 32 bytes). Workers and API routes decrypt server-side only —
 * key material never reaches a client or a model context (acceptance check
 * 10).
 */

const VERSION = "v1";

function masterKey(): Buffer {
  const raw = process.env.SETTINGS_ENCRYPTION_KEY ?? "";
  if (!raw) {
    throw new Error(
      "SETTINGS_ENCRYPTION_KEY is not configured — refusing to store or read key material (fail closed).",
    );
  }
  const decoded = Buffer.from(raw, "base64");
  if (decoded.length === 32 && raw.trim().length > 0) return decoded;
  const hex = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : null;
  if (hex) return hex;
  return createHash("sha256").update(raw).digest();
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(":");
}

export function decryptSecret(encrypted: string): string {
  const [version, ivB64, tagB64, dataB64] = encrypted.split(":");
  if (version !== VERSION || !ivB64 || !tagB64 || !dataB64) {
    throw new Error("Unsupported ciphertext format for stored model key.");
  }
  const decipher = createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
