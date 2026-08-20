import {
  decryptJsonFromStorage,
  decryptStringFromStorage,
  maybeEncryptJsonForStorage,
  maybeEncryptStringForStorage,
} from "./fieldEncryption";

const PAYSLIP_CORRECTION_PURPOSE = "payslip-correction-financial-snapshot";
const PAYSLIP_CORRECTION_REASON_PURPOSE = "payslip-correction-reason";
const PAYROLL_VOID_REASON_PURPOSE = "payroll-void-reason";
const PAYROLL_JOURNAL_REASON_PURPOSE = "payroll-journal-reason";

export function encryptPayslipCorrectionSnapshot(payload: unknown): string {
  return maybeEncryptJsonForStorage(payload, PAYSLIP_CORRECTION_PURPOSE);
}

export function decryptPayslipCorrectionSnapshot<T>(payload: string): T {
  return decryptJsonFromStorage<T>(payload, PAYSLIP_CORRECTION_PURPOSE);
}

export function encryptPayslipCorrectionReason(reason: string): string {
  return maybeEncryptStringForStorage(
    reason,
    PAYSLIP_CORRECTION_REASON_PURPOSE,
  );
}

export function decryptPayslipCorrectionReason(reason: string): string {
  return decryptStringFromStorage(reason, PAYSLIP_CORRECTION_REASON_PURPOSE);
}

export function encryptPayrollVoidReason(reason: string): string {
  return maybeEncryptStringForStorage(reason, PAYROLL_VOID_REASON_PURPOSE);
}

export function decryptPayrollVoidReason(reason: string): string {
  return decryptStringFromStorage(reason, PAYROLL_VOID_REASON_PURPOSE);
}

export function encryptPayrollJournalReason(reason: string): string {
  return maybeEncryptStringForStorage(reason, PAYROLL_JOURNAL_REASON_PURPOSE);
}

export function decryptPayrollJournalReason(reason: string): string {
  return decryptStringFromStorage(reason, PAYROLL_JOURNAL_REASON_PURPOSE);
}
