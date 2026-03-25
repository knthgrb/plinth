/**
 * PDF user (open) password for emailed payslips.
 *
 * Plinth uses Better Auth: login passwords are hashed and cannot be recovered server-side,
 * so they cannot be embedded as the PDF password. We use values only the employee should know
 * from HR records: date of birth (DDMMYYYY) or company employee ID.
 */
export function getPayslipPdfOpenPassword(employee: {
  personalInfo: { dateOfBirth?: number | null };
  employment: { employeeId: string };
}): string {
  const dob = employee.personalInfo?.dateOfBirth;
  if (typeof dob === "number" && dob > 0) {
    const d = new Date(dob);
    const dd = String(d.getUTCDate()).padStart(2, "0");
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const yyyy = String(d.getUTCFullYear());
    return `${dd}${mm}${yyyy}`;
  }
  const id = String(employee.employment?.employeeId ?? "").trim();
  return id.length > 0 ? id : "employee";
}

export function payslipPdfPasswordDescription(): string {
  return "Use your date of birth as DDMMYYYY, or your company employee ID if no date of birth is on file.";
}
