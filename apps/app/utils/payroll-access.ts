export const DEFAULT_PAYROLL_TAB_PASSWORD = "1234";

type PayrollAccessSettings = {
  payrollTabPassword?: string | null;
} | null | undefined;

export function getPayrollTabPassword(settings: PayrollAccessSettings): string {
  return settings?.payrollTabPassword ?? DEFAULT_PAYROLL_TAB_PASSWORD;
}

export function isPayrollPasswordRequired(
  settings: PayrollAccessSettings,
): boolean {
  return getPayrollTabPassword(settings).trim().length > 0;
}

export function isPayrollPasswordCorrect(
  input: string,
  settings: PayrollAccessSettings,
): boolean {
  const password = getPayrollTabPassword(settings).trim();
  return password.length === 0 || input.trim() === password;
}

export function getPayrollUnlockStorageKey(organizationId: string): string {
  return `plinth-payroll-unlocked:${organizationId}`;
}
