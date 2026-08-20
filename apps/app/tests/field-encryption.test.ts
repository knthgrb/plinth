import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assertSensitiveFieldEncryptionReady,
  isEncryptionEnabled,
} from "../convex/appEncryption";
import {
  decryptNumberFromStorage,
  decryptStringFromStorage,
  maybeEncryptNumberForStorage,
  maybeEncryptStringForStorage,
} from "../convex/fieldEncryption";
import { decryptPayslipRowFromDb } from "../convex/payslipCrypto";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("sensitive field encryption", () => {
  it("round-trips numbers and strings without storing plaintext", () => {
    vi.stubEnv("ENCRYPTION_KEY", "0123456789abcdef0123456789abcdef");

    const amount = maybeEncryptNumberForStorage(12_345.67);
    const account = maybeEncryptStringForStorage("001234567890", "bank-account");

    expect(amount).toBeTypeOf("string");
    expect(String(amount)).not.toContain("12345.67");
    expect(account).not.toContain("001234567890");
    expect(decryptNumberFromStorage(amount)).toBe(12_345.67);
    expect(decryptStringFromStorage(account, "bank-account")).toBe(
      "001234567890",
    );
  });

  it("throws on corrupted encrypted financial data", () => {
    vi.stubEnv("ENCRYPTION_KEY", "0123456789abcdef0123456789abcdef");
    expect(() => decryptNumberFromStorage("pp:enc:v1:corrupt")).toThrow();
    expect(() =>
      decryptPayslipRowFromDb({
        grossPay: "pp:enc:v1:corrupt",
        deductions: "pp:enc:v1:corrupt",
      }),
    ).toThrow();
  });

  it("fails closed for production-sensitive writes with a missing or weak key", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ENCRYPTION_KEY", "");
    expect(isEncryptionEnabled()).toBe(false);
    expect(() => assertSensitiveFieldEncryptionReady()).toThrow(
      "32-byte ENCRYPTION_KEY",
    );

    vi.stubEnv("ENCRYPTION_KEY", "sixteen-byte-key");
    expect(() => assertSensitiveFieldEncryptionReady()).toThrow(
      "32-byte ENCRYPTION_KEY",
    );
  });
});
