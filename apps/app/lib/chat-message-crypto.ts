/**
 * Client-side chat message body crypto (must match convex/chatMessageBodyCrypto.ts).
 */
import { gcm } from "@noble/ciphers/aes.js";
import {
  utf8ToBytes,
  bytesToUtf8,
  randomBytes,
} from "@noble/ciphers/utils.js";

export const CHAT_ENC_PREFIX = "pp:enc:v1:";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const sub = bytes.subarray(i, i + CHUNK);
    binary += String.fromCharCode.apply(null, sub as unknown as number[]);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
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
  if (raw.length < 13) return "[Unable to decrypt]";
  const nonce = raw.subarray(0, 12);
  const ct = raw.subarray(12);
  try {
    const aes = gcm(key32, nonce);
    return bytesToUtf8(aes.decrypt(ct));
  } catch {
    return "[Unable to decrypt]";
  }
}

export function sessionKeyFromBase64(b64: string): Uint8Array {
  const u = base64ToBytes(b64);
  if (u.length !== 32) throw new Error("Invalid session key");
  return u;
}

export function encryptWithSessionKeyB64(
  plaintext: string,
  sessionKeyBase64: string,
): string {
  return encryptUtf8(plaintext, sessionKeyFromBase64(sessionKeyBase64));
}

export function decryptWithSessionKeyB64(
  stored: string,
  sessionKeyBase64: string,
): string {
  return decryptUtf8(stored, sessionKeyFromBase64(sessionKeyBase64));
}
