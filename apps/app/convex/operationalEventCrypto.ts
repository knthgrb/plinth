import {
  assertSensitiveFieldEncryptionReady,
  isEncryptionEnabled,
} from "./appEncryption";
import {
  decryptJsonFromStorage,
  maybeEncryptJsonForStorage,
} from "./fieldEncryption";

export function encodeOperationalEventPayload(payload: unknown): string {
  assertSensitiveFieldEncryptionReady();
  if (isEncryptionEnabled()) {
    return maybeEncryptJsonForStorage(payload, "operational-event-payload");
  }
  return JSON.stringify(payload);
}

export function decodeOperationalEventPayload(payload: string): unknown {
  return decryptJsonFromStorage<unknown>(
    payload,
    "operational-event-payload",
  );
}
