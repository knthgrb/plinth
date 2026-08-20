const MAX_EMPLOYEES_PER_PAYROLL_RUN = 500;
const MAX_LINES_PER_EMPLOYEE = 100;
const MAX_LINE_NAME_LENGTH = 120;
const MAX_LINE_TYPE_LENGTH = 60;
const MIN_PAYROLL_YEAR = 1900;
const MAX_PAYROLL_YEAR = 2200;

type PayrollLineInput = {
  name: string;
  type: string;
  amount: number;
};

type EmployeeLineInput = {
  employeeId: string;
  lines: readonly PayrollLineInput[];
};

export type PayrollRunInput = {
  cutoffStart: number;
  cutoffEnd: number;
  employeeIds: readonly string[];
  manualDeductions?: readonly EmployeeLineInput[];
  incentives?: readonly EmployeeLineInput[];
};

export type PayslipEditInput = {
  deductions?: readonly PayrollLineInput[];
  incentives?: readonly PayrollLineInput[];
  nonTaxableAllowance?: number;
  variableEarnings?: Readonly<Record<string, number>>;
  correctionReason?: string;
};

function assertFiniteTimestamp(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a valid timestamp.`);
  }
}

function assertUniqueEmployeeIds(employeeIds: readonly string[]): void {
  if (employeeIds.length === 0) {
    throw new Error("A payroll run must include at least one employee.");
  }
  if (employeeIds.length > MAX_EMPLOYEES_PER_PAYROLL_RUN) {
    throw new Error(
      `A payroll run can include at most ${MAX_EMPLOYEES_PER_PAYROLL_RUN} employees. Process a smaller batch.`,
    );
  }
  if (new Set(employeeIds).size !== employeeIds.length) {
    throw new Error("Duplicate employees are not allowed in a payroll run.");
  }
}

function assertValidLineEntries(
  label: string,
  entries: readonly EmployeeLineInput[] | undefined,
  selectedEmployeeIds: ReadonlySet<string>,
): void {
  if (!entries) return;
  const entryEmployeeIds = new Set<string>();
  for (const entry of entries) {
    if (!selectedEmployeeIds.has(entry.employeeId)) {
      throw new Error(
        `${label} includes an employee outside this payroll run.`,
      );
    }
    if (entryEmployeeIds.has(entry.employeeId)) {
      throw new Error(`${label} contains duplicate entries for an employee.`);
    }
    entryEmployeeIds.add(entry.employeeId);
    assertValidPayrollLines(label, entry.lines);
  }
}

export function assertValidPayrollLines(
  label: string,
  lines: readonly PayrollLineInput[],
): void {
  if (lines.length > MAX_LINES_PER_EMPLOYEE) {
    throw new Error(
      `${label} can include at most ${MAX_LINES_PER_EMPLOYEE} lines per employee.`,
    );
  }
  for (const line of lines) {
    const name = line.name.trim();
    if (!name) throw new Error(`${label} line name is required.`);
    if (name.length > MAX_LINE_NAME_LENGTH) {
      throw new Error(
        `${label} line name cannot exceed ${MAX_LINE_NAME_LENGTH} characters.`,
      );
    }
    const type = line.type.trim();
    if (!type) throw new Error(`${label} line type is required.`);
    if (type.length > MAX_LINE_TYPE_LENGTH) {
      throw new Error(
        `${label} line type cannot exceed ${MAX_LINE_TYPE_LENGTH} characters.`,
      );
    }
    if (!Number.isFinite(line.amount) || line.amount < 0) {
      throw new Error(
        `${label} line amount must be a finite non-negative number.`,
      );
    }
  }
}

export function assertValidPayslipEditInput(input: PayslipEditInput): void {
  if (input.deductions) {
    assertValidPayrollLines("Deduction", input.deductions);
  }
  if (input.incentives) {
    assertValidPayrollLines("Incentive", input.incentives);
  }
  if (
    input.nonTaxableAllowance !== undefined &&
    (!Number.isFinite(input.nonTaxableAllowance) ||
      input.nonTaxableAllowance < 0)
  ) {
    throw new Error(
      "Non-taxable allowance must be a finite non-negative number.",
    );
  }
  for (const [name, amount] of Object.entries(input.variableEarnings ?? {})) {
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error(
        `${name} must be a finite non-negative variable earning.`,
      );
    }
  }
  if ((input.correctionReason?.trim().length ?? 0) > 1_000) {
    throw new Error("Correction reason cannot exceed 1000 characters.");
  }
}

export function assertValidPayrollRunInput(input: PayrollRunInput): void {
  assertFiniteTimestamp(input.cutoffStart, "Cutoff start");
  assertFiniteTimestamp(input.cutoffEnd, "Cutoff end");
  if (input.cutoffStart > input.cutoffEnd) {
    throw new Error("Cutoff start must be on or before cutoff end.");
  }
  assertUniqueEmployeeIds(input.employeeIds);
  const selectedEmployeeIds = new Set(input.employeeIds);
  assertValidLineEntries(
    "Manual deduction",
    input.manualDeductions,
    selectedEmployeeIds,
  );
  assertValidLineEntries("Incentive", input.incentives, selectedEmployeeIds);
}

export function assertValidPayrollYear(year: number): void {
  if (
    !Number.isInteger(year) ||
    year < MIN_PAYROLL_YEAR ||
    year > MAX_PAYROLL_YEAR
  ) {
    throw new Error(
      `Payroll year must be a whole calendar year from ${MIN_PAYROLL_YEAR} through ${MAX_PAYROLL_YEAR}.`,
    );
  }
}
