import {
  decryptJsonFromStorage,
  decryptStringFromStorage,
  maybeEncryptJsonForStorage,
  maybeEncryptStringForStorage,
} from "./fieldEncryption";

export type GovernmentRemittanceDetailsKind =
  | "details"
  | "filing"
  | "payment"
  | "failure";

function detailsPurpose(kind: GovernmentRemittanceDetailsKind): string {
  return `government-remittance-${kind}`;
}

export function encryptGovernmentRemittanceDetails(
  payload: unknown,
  kind: GovernmentRemittanceDetailsKind = "details",
): string {
  return maybeEncryptJsonForStorage(payload, detailsPurpose(kind));
}

export function decryptGovernmentRemittanceDetails<T>(
  payload: string,
  kind: GovernmentRemittanceDetailsKind = "details",
): T {
  return decryptJsonFromStorage<T>(payload, detailsPurpose(kind));
}

export function encryptGovernmentRemittanceReason(reason: string): string {
  return maybeEncryptStringForStorage(
    reason,
    "government-remittance-lifecycle-reason",
  );
}

export function decryptGovernmentRemittanceReason(reason: string): string {
  return decryptStringFromStorage(
    reason,
    "government-remittance-lifecycle-reason",
  );
}

export function encryptGovernmentRemittanceNotes(notes: string): string {
  return maybeEncryptStringForStorage(notes, "government-remittance-notes");
}

export function decryptGovernmentRemittanceNotes(notes: string): string {
  return decryptStringFromStorage(notes, "government-remittance-notes");
}
