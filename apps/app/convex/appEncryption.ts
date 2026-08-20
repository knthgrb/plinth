/**
 * Single app secret for at-rest encryption (chat session wrap, field-level payroll/employee).
 * Set ENCRYPTION_KEY in Convex. Production-sensitive writes require at least
 * 32 UTF-8 bytes; development keeps legacy plaintext compatibility.
 */
import { utf8ToBytes } from "@noble/ciphers/utils.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";

export function getEncryptionKeyRaw(): Uint8Array | null {
  const s = process.env.ENCRYPTION_KEY;
  if (!s || s.length < 16) return null;
  return utf8ToBytes(s);
}

export function isEncryptionEnabled(): boolean {
  return getEncryptionKeyRaw() !== null;
}

export function assertSensitiveFieldEncryptionReady(): void {
  const requiresEncryption =
    process.env.NODE_ENV === "production" ||
    process.env.REQUIRE_FIELD_ENCRYPTION === "true";
  if (!requiresEncryption) return;
  const configured = process.env.ENCRYPTION_KEY;
  const byteLength = configured ? utf8ToBytes(configured).length : 0;
  if (byteLength < 32) {
    throw new Error(
      "Sensitive production writes require a 32-byte ENCRYPTION_KEY.",
    );
  }
}

/** Derive a 32-byte key for a specific domain (chat wrap, payslip fields, etc.). */
export function deriveSubkey(purpose: string): Uint8Array {
  const master = getEncryptionKeyRaw();
  if (!master) throw new Error("ENCRYPTION_KEY not configured");
  return hkdf(
    sha256,
    master,
    utf8ToBytes(purpose),
    utf8ToBytes("plinth-app"),
    32,
  );
}
