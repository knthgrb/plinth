import { z } from "zod";

export const employeeFormSchema = z.object({
  firstName: z
    .string()
    .trim()
    .min(1, "First name is required"),
  lastName: z
    .string()
    .trim()
    .min(1, "Last name is required"),
  middleName: z.string().optional(),
  email: z
    .string()
    .trim()
    .min(1, "Email is required")
    .email("Please enter a valid email address"),
  phone: z.string().optional(),
  position: z
    .string()
    .trim()
    .min(1, "Position is required"),
  department: z
    .string()
    .trim()
    .min(1, "Department is required"),
  employmentType: z
    .string()
    .trim()
    .min(1, "Employment type is required"),
  hireDate: z
    .string()
    .trim()
    .min(1, "Hire date is required"),
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
    .refine(
      (value) => !value || !Number.isNaN(Number(value)),
      { message: "Allowance must be a valid number" }
    ),
  regularHolidayRate: z
    .string()
    .trim()
    .optional()
    .refine(
      (value) => !value || !Number.isNaN(Number(value)),
      { message: "Regular holiday rate must be a valid number" }
    ),
  specialHolidayRate: z
    .string()
    .trim()
    .optional()
    .refine(
      (value) => !value || !Number.isNaN(Number(value)),
      { message: "Special non-working holiday rate must be a valid number" }
    ),
  nightDiffPercent: z
    .string()
    .trim()
    .optional()
    .refine(
      (value) => !value || !Number.isNaN(Number(value)),
      { message: "Night differential must be a valid number" }
    ),
  overtimeRegularRate: z
    .string()
    .trim()
    .optional()
    .refine(
      (value) => !value || !Number.isNaN(Number(value)),
      { message: "Overtime regular rate must be a valid number" }
    ),
  overtimeRestDayRate: z
    .string()
    .trim()
    .optional()
    .refine(
      (value) => !value || !Number.isNaN(Number(value)),
      { message: "Overtime rest day rate must be a valid number" }
    ),
  regularHolidayOtRate: z
    .string()
    .trim()
    .optional()
    .refine(
      (value) => !value || !Number.isNaN(Number(value)),
      { message: "Regular holiday OT rate must be a valid number" }
    ),
  specialHolidayOtRate: z
    .string()
    .trim()
    .optional()
    .refine(
      (value) => !value || !Number.isNaN(Number(value)),
      { message: "Special non-working holiday OT rate must be a valid number" }
    ),
  salaryType: z
    .string()
    .trim()
    .min(1, "Salary type is required"),
});

export type EmployeeFormValues = z.infer<typeof employeeFormSchema>;

export type EmployeeFormErrors = Partial<
  Record<keyof EmployeeFormValues, string>
>;

export function validateEmployeeForm(
  values: EmployeeFormValues
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

