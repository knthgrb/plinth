import { z } from "zod";

function isFutureDateInput(value: string): boolean {
  if (!value) return false;
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return false;

  const today = new Date();
  const todayStart = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );

  return parsed.getTime() > todayStart.getTime();
}

export const employeeFormSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required"),
  lastName: z.string().trim().min(1, "Last name is required"),
  middleName: z.string().optional(),
  email: z
    .string()
    .trim()
    .min(1, "Email is required")
    .email("Please enter a valid email address"),
  phone: z.string().optional(),
  province: z.string().optional(),
  position: z.string().trim().min(1, "Position is required"),
  department: z.string().trim().min(1, "Department is required"),
  employmentType: z.string().trim().min(1, "Employment type is required"),
  hireDate: z
    .string()
    .trim()
    .min(1, "Hire date is required")
    .refine((value) => !isFutureDateInput(value), {
      message: "Hire date cannot be in the future",
    }),
  regularizationDate: z.string().trim().optional(),
  basicSalary: z
    .string()
    .trim()
    .min(1, "Basic salary is required")
    .refine((value) => !Number.isNaN(Number(value)), {
      message: "Basic salary must be a valid number",
    }),
  allowance: z
    .string()
    .trim()
    .optional()
    .refine((value) => !value || !Number.isNaN(Number(value)), {
      message: "Allowance must be a valid number",
    }),
  regularHolidayRate: z
    .string()
    .trim()
    .optional()
    .refine((value) => !value || !Number.isNaN(Number(value)), {
      message: "Regular holiday rate must be a valid number",
    }),
  specialHolidayRate: z
    .string()
    .trim()
    .optional()
    .refine((value) => !value || !Number.isNaN(Number(value)), {
      message: "Special non-working holiday rate must be a valid number",
    }),
  nightDiffPercent: z
    .string()
    .trim()
    .optional()
    .refine((value) => !value || !Number.isNaN(Number(value)), {
      message: "Night differential must be a valid number",
    }),
  overtimeRegularRate: z
    .string()
    .trim()
    .optional()
    .refine((value) => !value || !Number.isNaN(Number(value)), {
      message: "Overtime regular rate must be a valid number",
    }),
  overtimeRestDayRate: z
    .string()
    .trim()
    .optional()
    .refine((value) => !value || !Number.isNaN(Number(value)), {
      message: "Overtime rest day rate must be a valid number",
    }),
  salaryType: z.string().trim().min(1, "Salary type is required"),
});

export type EmployeeFormValues = z.infer<typeof employeeFormSchema>;

export type EmployeeFormErrors = Partial<
  Record<keyof EmployeeFormValues, string>
>;

export function validateEmployeeForm(
  values: EmployeeFormValues,
): EmployeeFormErrors {
  const result = employeeFormSchema.safeParse(values);

  if (result.success) {
    return {};
  }

  const fieldErrors: EmployeeFormErrors = {};

  for (const issue of result.error.issues) {
    const field = issue.path[0] as keyof EmployeeFormValues;
    if (!fieldErrors[field]) {
      fieldErrors[field] = issue.message;
    }
  }

  return fieldErrors;
}
