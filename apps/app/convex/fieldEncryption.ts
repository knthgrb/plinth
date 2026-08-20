import { encryptUtf8, decryptUtf8, isEncryptedPayload } from "./chatMessageBodyCrypto";
import {
  assertSensitiveFieldEncryptionReady,
  deriveSubkey,
  getEncryptionKeyRaw,
  isEncryptionEnabled,
} from "./appEncryption";

const PURPOSE_AMOUNT = "field-amount";
const PURPOSE_JSON = "field-json";

export function maybeEncryptNumberForStorage(n: number): number | string {
  assertSensitiveFieldEncryptionReady();
  if (!isEncryptionEnabled()) return n;
  if (!Number.isFinite(n)) throw new Error("Financial amount must be finite.");
  const key = deriveSubkey(PURPOSE_AMOUNT);
  return encryptUtf8(String(n), key);
}

export function decryptNumberFromStorage(v: number | string | undefined): number {
  if (v === undefined) return 0;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error("Stored financial amount is invalid.");
    return v;
  }
  if (typeof v !== "string") throw new Error("Stored financial amount is invalid.");
  const plaintext = isEncryptedPayload(v)
    ? decryptUtf8(v, deriveSubkey(PURPOSE_AMOUNT))
    : v;
  const parsed = Number(plaintext);
  if (!Number.isFinite(parsed)) {
    throw new Error("Stored financial amount is invalid.");
  }
  return parsed;
}

export function maybeEncryptJsonForStorage(
  obj: unknown,
  purpose = PURPOSE_JSON,
): string {
  assertSensitiveFieldEncryptionReady();
  if (!isEncryptionEnabled()) return JSON.stringify(obj);
  const key = deriveSubkey(purpose);
  return encryptUtf8(JSON.stringify(obj), key);
}

export function decryptJsonFromStorage<T>(
  v: string | T,
  purpose = PURPOSE_JSON,
): T {
  if (typeof v !== "string") return v as T;
  if (!isEncryptedPayload(v)) return JSON.parse(v) as T;
  const key = deriveSubkey(purpose);
  return JSON.parse(decryptUtf8(v, key)) as T;
}

export function maybeEncryptStringForStorage(
  value: string,
  purpose: string,
): string {
  assertSensitiveFieldEncryptionReady();
  if (!isEncryptionEnabled()) return value;
  return encryptUtf8(value, deriveSubkey(`field-string:${purpose}`));
}

export function decryptStringFromStorage(
  value: string,
  purpose: string,
): string {
  if (!isEncryptedPayload(value)) return value;
  return decryptUtf8(value, deriveSubkey(`field-string:${purpose}`));
}

/** For guards that only checked master secret presence. */
export function hasEncryptionKey(): boolean {
  return getEncryptionKeyRaw() !== null;
}
