import { validateEmployeeForm } from "./employee-form-validation";
import type { EmployeeFormValues } from "./employee-form-validation";

/** CSV column headers matching Add Employee form fields */
export const EMPLOYEE_CSV_HEADERS = [
  "firstName",
  "lastName",
  "middleName",
  "email",
  "phone",
  "position",
  "department",
  "employmentType",
  "hireDate",
  "basicSalary",
  "allowance",
  "salaryType",
  "regularHolidayRate",
  "specialHolidayRate",
  "nightDiffPercent",
  "overtimeRegularRate",
  "overtimeRestDayRate",
  "regularHolidayOtRate",
  "specialHolidayOtRate",
] as const;

export type EmployeeCsvHeader = (typeof EMPLOYEE_CSV_HEADERS)[number];

/** Default schedule (9–6 weekdays) used for bulk-created employees */
export const DEFAULT_BULK_SCHEDULE = {
  monday: { in: "09:00", out: "18:00", isWorkday: true },
  tuesday: { in: "09:00", out: "18:00", isWorkday: true },
  wednesday: { in: "09:00", out: "18:00", isWorkday: true },
  thursday: { in: "09:00", out: "18:00", isWorkday: true },
  friday: { in: "09:00", out: "18:00", isWorkday: true },
  saturday: { in: "09:00", out: "18:00", isWorkday: false },
  sunday: { in: "09:00", out: "18:00", isWorkday: false },
};

/** Build one CSV row from values (escape quotes and wrap in quotes if contains comma) */
function escapeCsvCell(value: string): string {
  const s = String(value ?? "").trim();
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Return CSV template string: header row + one sample data row */
export function getEmployeeCsvTemplate(): string {
  const headerLine = EMPLOYEE_CSV_HEADERS.join(",");
  const sampleRow = [
    "Juan",
    "Dela Cruz",
    "M",
    "juan.delacruz@example.com",
    "09171234567",
    "Software Engineer",
    "IT Department",
    "probationary",
    "2025-01-15",
    "50000",
    "5000",
    "monthly",
    "100",
    "30",
    "10",
    "125",
    "169",
    "200",
    "169",
  ].map(escapeCsvCell).join(",");
  return [headerLine, sampleRow].join("\n");
}

/** Parse a single CSV line respecting quoted fields */
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += c;
    }
  }
  result.push(current.trim());
  return result;
}

export interface ParsedEmployeeRow {
  rowIndex: number; // 1-based for user display
  values: EmployeeFormValues;
  errors: Record<string, string>;
}

/**
 * Parse CSV text into rows and validate each row with the same schema as Add Employee form.
 * Returns parsed rows with validation errors per row.
 */
export function parseEmployeeCsv(csvText: string): ParsedEmployeeRow[] {
  const lines = csvText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return []; // need header + at least one data row

  const headerLine = lines[0];
  const headers = parseCsvLine(headerLine);
  const dataLines = lines.slice(1);
  const results: ParsedEmployeeRow[] = [];

  for (let i = 0; i < dataLines.length; i++) {
    const cells = parseCsvLine(dataLines[i]);
    const rowIndex = i + 2; // 1-based, and +1 because line 1 is header
    const raw: Record<string, string> = {};
    EMPLOYEE_CSV_HEADERS.forEach((h, idx) => {
      raw[h] = cells[idx] ?? "";
    });

    const values: EmployeeFormValues = {
      firstName: raw.firstName ?? "",
      lastName: raw.lastName ?? "",
      middleName: raw.middleName ?? "",
      email: raw.email ?? "",
      phone: raw.phone ?? "",
      position: raw.position ?? "",
      department: raw.department ?? "",
      employmentType: (raw.employmentType as EmployeeFormValues["employmentType"]) || "probationary",
      hireDate: raw.hireDate ?? "",
      basicSalary: raw.basicSalary ?? "",
      allowance: raw.allowance ?? "",
      salaryType: (raw.salaryType as EmployeeFormValues["salaryType"]) || "monthly",
      regularHolidayRate: raw.regularHolidayRate ?? "",
      specialHolidayRate: raw.specialHolidayRate ?? "",
      nightDiffPercent: raw.nightDiffPercent ?? "",
      overtimeRegularRate: raw.overtimeRegularRate ?? "",
      overtimeRestDayRate: raw.overtimeRestDayRate ?? "",
      regularHolidayOtRate: raw.regularHolidayOtRate ?? "",
      specialHolidayOtRate: raw.specialHolidayOtRate ?? "",
    };

    const errors = validateEmployeeForm(values);
    results.push({ rowIndex, values, errors });
  }

  return results;
}
