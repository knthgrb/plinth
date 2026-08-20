import {
  decryptJsonFromStorage,
  maybeEncryptJsonForStorage,
} from "./fieldEncryption";
import {
  assertSensitiveFieldEncryptionReady,
  isEncryptionEnabled,
} from "./appEncryption";
import type { Doc } from "./_generated/dataModel";

type PayrollDraftConfig = Exclude<
  Doc<"payrollRuns">["draftConfig"],
  string | undefined
>;

export function encryptDraftConfigForDb(
  cfg: PayrollDraftConfig | undefined,
): Doc<"payrollRuns">["draftConfig"] {
  if (!cfg) return cfg;
  assertSensitiveFieldEncryptionReady();
  if (!isEncryptionEnabled()) return cfg;
  return maybeEncryptJsonForStorage(cfg);
}

export function decryptDraftConfigFromDb(
  cfg: Doc<"payrollRuns">["draftConfig"] | null,
): PayrollDraftConfig | undefined {
  if (cfg == null) return undefined;
  if (typeof cfg === "object") return cfg;
  return decryptJsonFromStorage<PayrollDraftConfig>(cfg);
}

type DecryptedPayrollRun<T> = T extends Doc<"payrollRuns">
  ? Omit<T, "draftConfig"> & { draftConfig?: PayrollDraftConfig }
  : T;

export function decryptPayrollRunFromDb<
  T extends Doc<"payrollRuns"> | null | undefined,
>(run: T): DecryptedPayrollRun<T> {
  if (!run) return run as DecryptedPayrollRun<T>;
  return {
    ...run,
    draftConfig: decryptDraftConfigFromDb(run.draftConfig),
  } as DecryptedPayrollRun<T>;
}
