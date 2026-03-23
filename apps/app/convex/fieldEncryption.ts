import { encryptUtf8, decryptUtf8, isEncryptedPayload } from "./chatMessageBodyCrypto";
import { deriveSubkey, getEncryptionKeyRaw, isEncryptionEnabled } from "./appEncryption";

const PURPOSE_AMOUNT = "field-amount";
const PURPOSE_JSON = "field-json";

export function maybeEncryptNumberForStorage(n: number): number | string {
  if (!isEncryptionEnabled()) return n;
  const key = deriveSubkey(PURPOSE_AMOUNT);
  return encryptUtf8(String(n), key);
}

export function decryptNumberFromStorage(v: number | string | undefined): number {
  if (v === undefined) return 0;
  if (typeof v === "number") return v;
  if (typeof v !== "string") return 0;
  if (!isEncryptedPayload(v)) return Number(v) || 0;
  try {
    const key = deriveSubkey(PURPOSE_AMOUNT);
    return parseFloat(decryptUtf8(v, key)) || 0;
  } catch {
    return 0;
  }
}

export function maybeEncryptJsonForStorage(obj: unknown): string {
  const key = deriveSubkey(PURPOSE_JSON);
  return encryptUtf8(JSON.stringify(obj), key);
}

export function decryptJsonFromStorage<T>(v: string | T): T {
  if (typeof v !== "string") return v as T;
  if (!isEncryptedPayload(v)) return JSON.parse(v) as T;
  const key = deriveSubkey(PURPOSE_JSON);
  return JSON.parse(decryptUtf8(v, key)) as T;
}

/** For guards that only checked master secret presence. */
export function hasEncryptionKey(): boolean {
  return getEncryptionKeyRaw() !== null;
}
