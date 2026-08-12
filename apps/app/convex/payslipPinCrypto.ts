"use node";

import {
  createHash,
  randomBytes,
  scrypt as nodeScrypt,
  timingSafeEqual,
} from "node:crypto";

const SCRYPT_COST = 16_384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const SCRYPT_KEY_LENGTH = 32;
const LEGACY_PIN_SALT_PREFIX = "payslip-pin-v1-";

function deriveKey(
  pin: string,
  salt: Buffer,
  keyLength: number,
  options: { N: number; r: number; p: number; maxmem: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    nodeScrypt(pin, salt, keyLength, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

export function validateNewPayslipPin(pin: string): string {
  const normalized = pin.trim();
  if (!/^\d{6,12}$/.test(normalized)) {
    throw new Error("PIN must contain 6 to 12 digits");
  }
  return normalized;
}

export async function hashPayslipPin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  const derivedKey = await deriveKey(pin, salt, SCRYPT_KEY_LENGTH, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELIZATION,
    maxmem: 64 * 1024 * 1024,
  });

  return [
    "scrypt",
    "v1",
    SCRYPT_COST,
    SCRYPT_BLOCK_SIZE,
    SCRYPT_PARALLELIZATION,
    salt.toString("base64url"),
    derivedKey.toString("base64url"),
  ].join("$");
}

function verifyLegacyHash(
  pin: string,
  storedHash: string,
  employeeId: string | undefined,
): boolean {
  if (!employeeId || !/^[a-f0-9]{64}$/i.test(storedHash)) return false;
  const candidate = createHash("sha256")
    .update(`${LEGACY_PIN_SALT_PREFIX}${employeeId}-${pin}`)
    .digest();
  const expected = Buffer.from(storedHash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export async function verifyPayslipPinHash(
  pin: string,
  storedHash: string,
  employeeId?: string,
): Promise<boolean> {
  if (!storedHash.startsWith("scrypt$v1$")) {
    return verifyLegacyHash(pin, storedHash, employeeId);
  }

  const [, , cost, blockSize, parallelization, saltValue, hashValue] =
    storedHash.split("$");
  const salt = Buffer.from(saltValue ?? "", "base64url");
  const expected = Buffer.from(hashValue ?? "", "base64url");
  if (
    Number(cost) !== SCRYPT_COST ||
    Number(blockSize) !== SCRYPT_BLOCK_SIZE ||
    Number(parallelization) !== SCRYPT_PARALLELIZATION ||
    salt.length !== 16 ||
    expected.length !== SCRYPT_KEY_LENGTH
  ) {
    return false;
  }

  const candidate = await deriveKey(pin, salt, expected.length, {
    N: Number(cost),
    r: Number(blockSize),
    p: Number(parallelization),
    maxmem: 64 * 1024 * 1024,
  });
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function isLegacyPayslipPinHash(storedHash: string): boolean {
  return /^[a-f0-9]{64}$/i.test(storedHash);
}
