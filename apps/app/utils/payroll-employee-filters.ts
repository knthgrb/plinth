export type PayrollEmployeeLike = {
  _id: string;
  employment?: {
    status?: string | null;
  } | null;
};

export function getActivePayrollEmployees<T extends PayrollEmployeeLike>(
  employees: T[] | null | undefined,
): T[] {
  return (employees ?? []).filter(
    (employee) => employee.employment?.status === "active",
  );
}

export function getActivePayrollEmployeeIds<T extends PayrollEmployeeLike>(
  employees: T[] | null | undefined,
): string[] {
  return getActivePayrollEmployees(employees).map((employee) => employee._id);
}
