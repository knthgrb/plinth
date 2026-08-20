import {
  decryptJsonFromStorage,
  decryptStringFromStorage,
  maybeEncryptJsonForStorage,
  maybeEncryptStringForStorage,
} from "./fieldEncryption";

const PURPOSE = "attendance-audit-snapshot";
const REASON_PURPOSE = "attendance-audit-correction-reason";

export function encryptAttendanceAuditSnapshot(value: unknown): string {
  return maybeEncryptJsonForStorage(value, PURPOSE);
}

export function decryptAttendanceAuditSnapshotForBoundary(
  value: string | undefined,
): string | undefined {
  if (value === undefined) return undefined;
  return JSON.stringify(decryptJsonFromStorage<unknown>(value, PURPOSE));
}

export function encryptAttendanceAuditCorrectionReason(
  value: string | undefined,
): string | undefined {
  return value === undefined
    ? undefined
    : maybeEncryptStringForStorage(value, REASON_PURPOSE);
}

export function decryptAttendanceAuditCorrectionReason(
  value: string | undefined,
): string | undefined {
  return value === undefined
    ? undefined
    : decryptStringFromStorage(value, REASON_PURPOSE);
}
