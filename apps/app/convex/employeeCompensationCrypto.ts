import {
  decryptNumberFromStorage,
  maybeEncryptNumberForStorage,
} from "./fieldEncryption";
import { isEncryptionEnabled } from "./appEncryption";

export function encryptCompensationForDb(comp: Record<string, any>) {
  if (!comp || !isEncryptionEnabled()) return comp;
  return {
    ...comp,
    basicSalary: maybeEncryptNumberForStorage(comp.basicSalary),
    allowance:
      comp.allowance !== undefined && comp.allowance !== null
        ? maybeEncryptNumberForStorage(comp.allowance)
        : comp.allowance,
  };
}

export function decryptCompensationFromDb(comp: Record<string, any>) {
  if (!comp) return comp;
  return {
    ...comp,
    basicSalary: decryptNumberFromStorage(comp.basicSalary),
    allowance:
      comp.allowance !== undefined && comp.allowance !== null
        ? decryptNumberFromStorage(comp.allowance)
        : comp.allowance,
  };
}

export function decryptEmployeeFromDb(emp: any): any {
  if (!emp) return emp;
  const safeEmployee = { ...emp };
  delete safeEmployee.payslipPinHash;
  delete safeEmployee.payslipPdfPassword;
  return {
    ...safeEmployee,
    compensation: decryptCompensationFromDb(emp.compensation),
  };
}
