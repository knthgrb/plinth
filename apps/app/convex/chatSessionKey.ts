/**
 * Wraps per-conversation AES keys with a KEK derived from ENCRYPTION_KEY.
 */
import { gcm } from "@noble/ciphers/aes.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes, randomBytes } from "@noble/ciphers/utils.js";
import { getEncryptionKeyRaw } from "./appEncryption";

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function base64ToBytes(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, "base64"));
}

/** @deprecated use getEncryptionKeyRaw from appEncryption */
export function getChatMasterSecret(): Uint8Array | null {
  return getEncryptionKeyRaw();
}

export function deriveKek(organizationId: string, conversationId: string): Uint8Array {
  const master = getEncryptionKeyRaw();
  if (!master) throw new Error("ENCRYPTION_KEY not configured");
  const salt = utf8ToBytes(`${organizationId}:${conversationId}`);
  return hkdf(sha256, master, salt, utf8ToBytes("plinth-chat-session-kek"), 32);
}

export function wrapSessionKey(
  sessionKey32: Uint8Array,
  organizationId: string,
  conversationId: string,
): string {
  if (sessionKey32.length !== 32) throw new Error("Session key must be 32 bytes");
  const kek = deriveKek(organizationId, conversationId);
  const nonce = randomBytes(12);
  const aes = gcm(kek, nonce);
  const ct = aes.encrypt(sessionKey32);
  const packed = new Uint8Array(12 + ct.length);
  packed.set(nonce, 0);
  packed.set(ct, 12);
  return bytesToBase64(packed);
}

export function unwrapSessionKey(
  wrappedB64: string,
  organizationId: string,
  conversationId: string,
): Uint8Array {
  const kek = deriveKek(organizationId, conversationId);
  const raw = base64ToBytes(wrappedB64);
  if (raw.length < 13) throw new Error("Invalid wrapped session key");
  const nonce = raw.subarray(0, 12);
  const ct = raw.subarray(12);
  const aes = gcm(kek, nonce);
  return aes.decrypt(ct);
}
