/**
 * AES-256-GCM for chat message bodies. Stored as CHAT_ENC_PREFIX + base64(nonce12 || ciphertext+tag).
 * Duplicated for Convex bundle; keep in sync with lib/chat-message-crypto.ts.
 */
import { gcm } from "@noble/ciphers/aes.js";
import {
  utf8ToBytes,
  bytesToUtf8,
  randomBytes,
} from "@noble/ciphers/utils.js";

export const CHAT_ENC_PREFIX = "pp:enc:v1:";

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function base64ToBytes(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, "base64"));
}

export function isEncryptedPayload(s: string): boolean {
  return typeof s === "string" && s.startsWith(CHAT_ENC_PREFIX);
}

export function encryptUtf8(plaintext: string, key32: Uint8Array): string {
  if (key32.length !== 32) {
    throw new Error("Chat message key must be 32 bytes");
  }
  const nonce = randomBytes(12);
  const aes = gcm(key32, nonce);
  const ct = aes.encrypt(utf8ToBytes(plaintext));
  const packed = new Uint8Array(12 + ct.length);
  packed.set(nonce, 0);
  packed.set(ct, 12);
  return CHAT_ENC_PREFIX + bytesToBase64(packed);
}

export function decryptUtf8(stored: string, key32: Uint8Array): string {
  if (!isEncryptedPayload(stored)) return stored;
  if (key32.length !== 32) {
    throw new Error("Chat message key must be 32 bytes");
  }
  const raw = base64ToBytes(stored.slice(CHAT_ENC_PREFIX.length));
  if (raw.length < 13) throw new Error("Invalid encrypted payload");
  const nonce = raw.subarray(0, 12);
  const ct = raw.subarray(12);
  const aes = gcm(key32, nonce);
  return bytesToUtf8(aes.decrypt(ct));
}
