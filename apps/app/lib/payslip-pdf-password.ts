/**
 * PDF user (open) password for emailed payslips.
 *
 * Plinth uses Better Auth: login passwords are hashed and cannot be recovered server-side,
 * so they cannot be embedded as the PDF password. We use the company employee ID.
 */
export function getPayslipPdfOpenPassword(employee: {
  personalInfo: { dateOfBirth?: number | null };
  employment: { employeeId: string };
  payslipPdfPassword?: string;
}): string {
  const customPassword = String(employee.payslipPdfPassword ?? "").trim();
  if (customPassword.length > 0) return customPassword;
  const id = String(employee.employment?.employeeId ?? "").trim();
  return id.length > 0 ? id : "employee";
}

export function payslipPdfPasswordDescription(): string {
  return "Use your company employee ID.";
}
