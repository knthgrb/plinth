import {
  decryptNumberFromStorage,
  maybeEncryptNumberForStorage,
} from "./fieldEncryption";
import { isEncryptionEnabled } from "./appEncryption";

type StoredCompensation = Record<string, unknown> & {
  basicSalary: number | string;
  allowance?: number | string | null;
};

type EncryptedCompensation<T extends StoredCompensation> = Omit<
  T,
  "basicSalary" | "allowance"
> & {
  basicSalary: number | string;
  allowance?: number | string | null;
};

type DecryptedCompensation<T extends StoredCompensation> = Omit<
  T,
  "basicSalary" | "allowance"
> & {
  basicSalary: number;
  allowance?: number | null;
};

export function encryptCompensationForDb<T extends StoredCompensation>(
  comp: T,
): EncryptedCompensation<T> {
  if (!isEncryptionEnabled()) return comp;
  return {
    ...comp,
    basicSalary:
      typeof comp.basicSalary === "number"
        ? maybeEncryptNumberForStorage(comp.basicSalary)
        : comp.basicSalary,
    allowance:
      typeof comp.allowance === "number"
        ? maybeEncryptNumberForStorage(comp.allowance)
        : comp.allowance,
  };
}

export function decryptCompensationFromDb<T extends StoredCompensation>(
  comp: T,
): DecryptedCompensation<T> {
  return {
    ...comp,
    basicSalary: decryptNumberFromStorage(comp.basicSalary),
    allowance:
      comp.allowance !== undefined && comp.allowance !== null
        ? decryptNumberFromStorage(comp.allowance)
        : comp.allowance,
  };
}

export function decryptEmployeeFromDb<
  T extends { compensation: StoredCompensation },
>(emp: T): Omit<T, "compensation"> & {
  compensation: DecryptedCompensation<T["compensation"]>;
} {
  return {
    ...emp,
    compensation: decryptCompensationFromDb(emp.compensation),
  };
}
