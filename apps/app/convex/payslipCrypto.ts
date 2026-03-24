import {
  decryptJsonFromStorage,
  decryptNumberFromStorage,
  maybeEncryptJsonForStorage,
  maybeEncryptNumberForStorage,
} from "./fieldEncryption";
import { isEncryptionEnabled } from "./appEncryption";

const NUMERIC_KEYS = [
  "grossPay",
  "basicPay",
  "netPay",
  "nonTaxableAllowance",
  "daysWorked",
  "absences",
  "lateHours",
  "undertimeHours",
  "overtimeHours",
  "holidayPay",
  "restDayPay",
  "nightDiffPay",
  "overtimeRegular",
  "overtimeRestDay",
  "overtimeRestDayExcess",
  "overtimeSpecialHoliday",
  "overtimeSpecialHolidayExcess",
  "overtimeLegalHoliday",
  "overtimeLegalHolidayExcess",
  "pendingDeductions",
] as const;

export function encryptPayslipRowForDb(
  row: Record<string, any>,
): Record<string, any> {
  if (!isEncryptionEnabled()) return row;
  const out = { ...row };
  for (const k of NUMERIC_KEYS) {
    if (typeof out[k] === "number" && !Number.isNaN(out[k])) {
      out[k] = maybeEncryptNumberForStorage(out[k]);
    }
  }
  if (Array.isArray(out.deductions)) {
    out.deductions = maybeEncryptJsonForStorage(out.deductions) as any;
  }
  if (Array.isArray(out.incentives) && out.incentives.length > 0) {
    out.incentives = maybeEncryptJsonForStorage(out.incentives) as any;
  }
  if (Array.isArray(out.nightDiffBreakdown) && out.nightDiffBreakdown.length > 0) {
    out.nightDiffBreakdown = maybeEncryptJsonForStorage(
      out.nightDiffBreakdown,
    ) as any;
  }
  if (
    out.employerContributions &&
    typeof out.employerContributions === "object"
  ) {
    out.employerContributions = maybeEncryptJsonForStorage(
      out.employerContributions,
    ) as any;
  }
  return out;
}

export function decryptPayslipRowFromDb(
  doc: Record<string, any> | null | undefined,
): Record<string, any> | null | undefined {
  if (!doc) return doc;
  const out = { ...doc };
  for (const k of NUMERIC_KEYS) {
    if (k in out && out[k] !== undefined && out[k] !== null) {
      out[k] = decryptNumberFromStorage(out[k]);
    }
  }
  if (typeof out.deductions === "string") {
    try {
      out.deductions = decryptJsonFromStorage(out.deductions);
    } catch {
      out.deductions = [];
    }
  } else if (!Array.isArray(out.deductions)) {
    out.deductions = [];
  }
  if (typeof out.incentives === "string") {
    try {
      out.incentives = decryptJsonFromStorage(out.incentives);
    } catch {
      out.incentives = undefined;
    }
  }
  if (typeof out.nightDiffBreakdown === "string") {
    try {
      out.nightDiffBreakdown = decryptJsonFromStorage(out.nightDiffBreakdown);
    } catch {
      out.nightDiffBreakdown = undefined;
    }
  } else if (!Array.isArray(out.nightDiffBreakdown)) {
    out.nightDiffBreakdown = undefined;
  }
  if (typeof out.employerContributions === "string") {
    try {
      out.employerContributions = decryptJsonFromStorage(
        out.employerContributions,
      );
    } catch {
      out.employerContributions = undefined;
    }
  }
  return out;
}

/** Encrypt only keys present (for db.patch). */
export function encryptPayslipPartialForDb(
  patch: Record<string, any>,
): Record<string, any> {
  if (!isEncryptionEnabled()) return patch;
  const out = { ...patch };
  for (const k of NUMERIC_KEYS) {
    if (
      k in out &&
      typeof out[k] === "number" &&
      !Number.isNaN(out[k] as number)
    ) {
      out[k] = maybeEncryptNumberForStorage(out[k]);
    }
  }
  if ("deductions" in out && Array.isArray(out.deductions)) {
    out.deductions = maybeEncryptJsonForStorage(out.deductions) as any;
  }
  if ("incentives" in out && Array.isArray(out.incentives)) {
    out.incentives = maybeEncryptJsonForStorage(out.incentives) as any;
  }
  if (
    "nightDiffBreakdown" in out &&
    Array.isArray(out.nightDiffBreakdown) &&
    out.nightDiffBreakdown.length > 0
  ) {
    out.nightDiffBreakdown = maybeEncryptJsonForStorage(
      out.nightDiffBreakdown,
    ) as any;
  }
  if (
    "employerContributions" in out &&
    out.employerContributions &&
    typeof out.employerContributions === "object"
  ) {
    out.employerContributions = maybeEncryptJsonForStorage(
      out.employerContributions,
    ) as any;
  }
  return out;
}
