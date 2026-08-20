import type { Id } from "./_generated/dataModel";
import {
  decryptJsonFromStorage,
  maybeEncryptJsonForStorage,
} from "./fieldEncryption";

export interface AccountingCostBreakdownLineItem {
  name: string;
  amount: number;
  type?: string;
}

export interface AccountingCostBreakdownRow {
  employeeId: Id<"employees">;
  employeeName: string;
  employeeAmount?: number;
  companyAmount?: number;
  grossPay?: number;
  nonTaxableAllowance?: number;
  totalIncentives?: number;
  totalDeductions?: number;
  incentiveItems?: AccountingCostBreakdownLineItem[];
  deductionItems?: AccountingCostBreakdownLineItem[];
  netPay?: number;
}

export interface AccountingCostBreakdown {
  kind: "payroll" | "contributions";
  rows: AccountingCostBreakdownRow[];
}

const PURPOSE = "accounting-cost-breakdown";

export function encryptAccountingCostBreakdown(
  breakdown: AccountingCostBreakdown | undefined,
): string | undefined {
  if (breakdown === undefined) return undefined;
  return maybeEncryptJsonForStorage(breakdown, PURPOSE);
}

export function decryptAccountingCostBreakdown(
  breakdown: AccountingCostBreakdown | string | undefined,
): AccountingCostBreakdown | undefined {
  if (breakdown === undefined) return undefined;
  return decryptJsonFromStorage<AccountingCostBreakdown>(breakdown, PURPOSE);
}
