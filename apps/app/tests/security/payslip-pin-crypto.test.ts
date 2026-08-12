import { describe, expect, it } from "vitest";
import {
  hashPayslipPin,
  validateNewPayslipPin,
  verifyPayslipPinHash,
} from "../../convex/payslipPinCrypto";

describe("payslip PIN credentials", () => {
  it("uses a different salted slow hash for the same PIN", async () => {
    const first = await hashPayslipPin("123456");
    const second = await hashPayslipPin("123456");

    expect(first).toMatch(/^scrypt\$v1\$/);
    expect(second).toMatch(/^scrypt\$v1\$/);
    expect(first).not.toBe(second);
    await expect(verifyPayslipPinHash("123456", first)).resolves.toBe(true);
    await expect(verifyPayslipPinHash("654321", first)).resolves.toBe(false);
  });

  it("requires a six-to-twelve digit PIN for new credentials", () => {
    expect(() => validateNewPayslipPin("1234")).toThrow(
      "PIN must contain 6 to 12 digits",
    );
    expect(() => validateNewPayslipPin("abcdef")).toThrow(
      "PIN must contain 6 to 12 digits",
    );
    expect(validateNewPayslipPin("123456")).toBe("123456");
  });

  it("verifies the legacy SHA-256 format for migration", async () => {
    const legacyHash =
      "0303f5f570162d3e11250e3ea9a557db2e79585b675e1edd2665903c5a08df36";

    await expect(
      verifyPayslipPinHash("1234", legacyHash, "employee-id"),
    ).resolves.toBe(true);
    await expect(
      verifyPayslipPinHash("9999", legacyHash, "employee-id"),
    ).resolves.toBe(false);
  });

  it("rejects malformed or attacker-controlled scrypt parameters safely", async () => {
    await expect(
      verifyPayslipPinHash(
        "123456",
        "scrypt$v1$999999999$8$1$c2FsdA$aGFzaA",
      ),
    ).resolves.toBe(false);
  });
});
