/** Session flag: user entered payslip PIN this tab session (org-scoped). */
export function payslipPinSessionKey(organizationId: string): string {
  return `plinth:payslipsPinOk:${organizationId}`;
}
