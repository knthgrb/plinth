import {
  decryptJsonFromStorage,
  maybeEncryptJsonForStorage,
} from "./fieldEncryption";
import { isEncryptionEnabled } from "./appEncryption";

export function encryptDraftConfigForDb(cfg: Record<string, any> | undefined) {
  if (!cfg) return cfg;
  if (!isEncryptionEnabled()) return cfg;
  return maybeEncryptJsonForStorage(cfg) as any;
}

export function decryptDraftConfigFromDb(
  cfg: Record<string, any> | string | undefined | null,
): any {
  if (cfg == null) return cfg;
  if (typeof cfg === "object") return cfg;
  if (typeof cfg === "string") {
    try {
      return decryptJsonFromStorage(cfg);
    } catch {
      return { employeeIds: [] };
    }
  }
  return cfg;
}

export function decryptPayrollRunFromDb(run: any): any {
  if (!run) return run;
  return {
    ...run,
    draftConfig: decryptDraftConfigFromDb(run.draftConfig),
  };
}
