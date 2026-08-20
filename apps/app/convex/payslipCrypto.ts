import {
  decryptJsonFromStorage,
  decryptNumberFromStorage,
  maybeEncryptJsonForStorage,
  maybeEncryptNumberForStorage,
} from "./fieldEncryption";
import {
  assertSensitiveFieldEncryptionReady,
  isEncryptionEnabled,
} from "./appEncryption";
import type { Doc } from "./_generated/dataModel";

const NUMERIC_KEYS = [
  "grossPay",
  "basicPay",
  "netPay",
  "nonTaxableAllowance",
  "daysWorked",
  "absences",
  "statutoryBenefitSupportedLeaveDays",
  "statutoryBenefitSupportedLeavePay",
  "lateHours",
  "undertimeHours",
  "overtimeHours",
  "holidayPay",
  "regularHolidayPay",
  "specialHolidayPay",
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
  "noWorkNoPayDays",
] as const;

type PayslipNumericKey = (typeof NUMERIC_KEYS)[number];
type PayslipDeduction = {
  name: string;
  amount: number;
  type: string;
};
type PayslipIncentive = PayslipDeduction & { taxable?: boolean };
type PayslipEmployerContributions = {
  sss?: number;
  philhealth?: number;
  pagibig?: number;
};
type PayslipNightDiffBreakdown = Exclude<
  Doc<"payslips">["nightDiffBreakdown"],
  string | undefined
>;
type PayslipEmployeeSnapshot = Exclude<
  Doc<"payslips">["employeeSnapshot"],
  string | undefined
>;

export type DecryptedPayslipDoc = {
  [Key in keyof Doc<"payslips">]: Key extends PayslipNumericKey
    ? number
    : Key extends "deductions"
      ? PayslipDeduction[]
      : Key extends "incentives"
        ? PayslipIncentive[]
        : Key extends "employerContributions"
          ? PayslipEmployerContributions
          : Key extends "nightDiffBreakdown"
            ? PayslipNightDiffBreakdown
            : Key extends "employeeSnapshot"
              ? PayslipEmployeeSnapshot
              : Doc<"payslips">[Key];
};

type UnknownRecord = Record<string, unknown>;

export function encryptPayslipRowForDb<T extends UnknownRecord>(row: T): T {
  assertSensitiveFieldEncryptionReady();
  if (!isEncryptionEnabled()) return row;
  const out: UnknownRecord = { ...row };
  for (const k of NUMERIC_KEYS) {
    const value = out[k];
    if (typeof value === "number" && !Number.isNaN(value)) {
      out[k] = maybeEncryptNumberForStorage(value);
    }
  }
  if (Array.isArray(out.deductions)) {
    out.deductions = maybeEncryptJsonForStorage(out.deductions);
  }
  if (Array.isArray(out.incentives) && out.incentives.length > 0) {
    out.incentives = maybeEncryptJsonForStorage(out.incentives);
  }
  if (
    Array.isArray(out.nightDiffBreakdown) &&
    out.nightDiffBreakdown.length > 0
  ) {
    out.nightDiffBreakdown = maybeEncryptJsonForStorage(
      out.nightDiffBreakdown,
    );
  }
  if (
    out.employerContributions &&
    typeof out.employerContributions === "object"
  ) {
    out.employerContributions = maybeEncryptJsonForStorage(
      out.employerContributions,
    );
  }
  if (out.employeeSnapshot && typeof out.employeeSnapshot === "object") {
    out.employeeSnapshot = maybeEncryptJsonForStorage(out.employeeSnapshot);
  }
  return out as T;
}

export function decryptPayslipRowFromDb(
  doc: Doc<"payslips"> | UnknownRecord | null | undefined,
): DecryptedPayslipDoc | null | undefined {
  if (!doc) return doc;
  const out: UnknownRecord = { ...doc };
  for (const k of NUMERIC_KEYS) {
    const stored = out[k];
    if (typeof stored === "number" || typeof stored === "string") {
      out[k] = decryptNumberFromStorage(stored);
    }
  }
  if (typeof out.deductions === "string") {
    out.deductions = decryptJsonFromStorage(out.deductions);
  } else if (!Array.isArray(out.deductions)) {
    out.deductions = [];
  }
  if (typeof out.incentives === "string") {
    out.incentives = decryptJsonFromStorage(out.incentives);
  }
  if (typeof out.nightDiffBreakdown === "string") {
    out.nightDiffBreakdown = decryptJsonFromStorage(out.nightDiffBreakdown);
  } else if (!Array.isArray(out.nightDiffBreakdown)) {
    out.nightDiffBreakdown = undefined;
  }
  if (typeof out.employerContributions === "string") {
    out.employerContributions = decryptJsonFromStorage(
      out.employerContributions,
    );
  }
  if (typeof out.employeeSnapshot === "string") {
    out.employeeSnapshot = decryptJsonFromStorage(out.employeeSnapshot);
  } else if (
    out.employeeSnapshot != null &&
    typeof out.employeeSnapshot !== "object"
  ) {
    out.employeeSnapshot = undefined;
  }
  return out as DecryptedPayslipDoc;
}

/** Encrypt only keys present (for db.patch). */
export function encryptPayslipPartialForDb<T extends UnknownRecord>(
  patch: T,
): T {
  assertSensitiveFieldEncryptionReady();
  if (!isEncryptionEnabled()) return patch;
  const out: UnknownRecord = { ...patch };
  for (const k of NUMERIC_KEYS) {
    const value = out[k];
    if (typeof value === "number" && !Number.isNaN(value)) {
      out[k] = maybeEncryptNumberForStorage(value);
    }
  }
  if ("deductions" in out && Array.isArray(out.deductions)) {
    out.deductions = maybeEncryptJsonForStorage(out.deductions);
  }
  if ("incentives" in out && Array.isArray(out.incentives)) {
    out.incentives = maybeEncryptJsonForStorage(out.incentives);
  }
  if (
    "nightDiffBreakdown" in out &&
    Array.isArray(out.nightDiffBreakdown) &&
    out.nightDiffBreakdown.length > 0
  ) {
    out.nightDiffBreakdown = maybeEncryptJsonForStorage(
      out.nightDiffBreakdown,
    );
  }
  if (
    "employerContributions" in out &&
    out.employerContributions &&
    typeof out.employerContributions === "object"
  ) {
    out.employerContributions = maybeEncryptJsonForStorage(
      out.employerContributions,
    );
  }
  if (
    "employeeSnapshot" in out &&
    out.employeeSnapshot &&
    typeof out.employeeSnapshot === "object"
  ) {
    out.employeeSnapshot = maybeEncryptJsonForStorage(out.employeeSnapshot);
  }
  return out as T;
}
