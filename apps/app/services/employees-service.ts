import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { getAuthedConvexClient } from "@/lib/convex-client";
import type { FunctionArgs } from "convex/server";

export type UpdateEmployeeInput = Omit<
  FunctionArgs<typeof api.employees.updateEmployee>,
  "employeeId"
>;

export class EmployeesService {
  static async createEmployee(data: {
    organizationId: string;
    accountAccess?:
      | { kind: "employee_only" }
      | { kind: "link_member"; userId: string }
      | { kind: "invite_member"; email: string };
    personalInfo: {
      firstName: string;
      lastName: string;
      middleName?: string;
      email: string;
      phone?: string;
      address?: string;
      province?: string;
      dateOfBirth?: number;
      civilStatus?: string;
      emergencyContact?: {
        name: string;
        relationship: string;
        phone: string;
      };
    };
    employment: {
      employeeId: string;
      position: string;
      department: string;
      employmentType: "regular" | "probationary" | "contractual" | "part-time";
      hireDate: number;
      regularizationDate?: number;
      separationDate?: number;
      lastWorkingDay?: number;
      separationReason?: string;
      finalPayStatus?:
        | "not_started"
        | "pending"
        | "processing"
        | "paid"
        | "not_applicable";
      clearanceStatus?: "not_started" | "pending" | "cleared" | "waived";
      status: "active";
    };
    compensation: {
      basicSalary: number;
      allowance?: number;
      salaryType: "monthly" | "daily" | "hourly";
      bankDetails?: {
        bankName: string;
        accountNumber: string;
        accountName: string;
      };
      regularHolidayRate?: number;
      specialHolidayRate?: number;
      nightDiffPercent?: number;
      overtimeRegularRate?: number;
      overtimeRestDayRate?: number;
      regularHolidayOtRate?: number;
      specialHolidayOtRate?: number;
    };
    schedule: {
      defaultSchedule: {
        monday: { in: string; out: string; isWorkday: boolean };
        tuesday: { in: string; out: string; isWorkday: boolean };
        wednesday: { in: string; out: string; isWorkday: boolean };
        thursday: { in: string; out: string; isWorkday: boolean };
        friday: { in: string; out: string; isWorkday: boolean };
        saturday: { in: string; out: string; isWorkday: boolean };
        sunday: { in: string; out: string; isWorkday: boolean };
      };
      scheduleOverrides?: Array<{
        date: number;
        in: string;
        out: string;
        reason: string;
      }>;
    };
    shiftId?: Id<"shifts"> | null;
  }) {
    const convex = await getAuthedConvexClient();
    return convex.mutation(api.employees.createEmployee, {
      ...data,
      organizationId: data.organizationId as Id<"organizations">,
      accountAccess:
        data.accountAccess?.kind === "link_member"
          ? {
              kind: "link_member" as const,
              userId: data.accountAccess.userId as Id<"users">,
            }
          : data.accountAccess,
    });
  }

  static async updateEmployee(
    employeeId: string,
    data: UpdateEmployeeInput,
  ) {
    const convex = await getAuthedConvexClient();
    return convex.mutation(api.employees.updateEmployee, {
      employeeId: employeeId as Id<"employees">,
      ...data,
    });
  }

  static async getEmployee(employeeId: string) {
    const convex = await getAuthedConvexClient();
    return convex.query(api.employees.getEmployee, {
      employeeId: employeeId as Id<"employees">,
    });
  }

  static async rehireEmployee(data: {
    employeeId: string;
    hireDate: number;
    position: string;
    department: string;
    employmentType: "regular" | "probationary" | "contractual" | "part-time";
  }) {
    const convex = await getAuthedConvexClient();
    return convex.mutation(api.employees.rehireEmployee, {
      ...data,
      employeeId: data.employeeId as Id<"employees">,
    });
  }

  static async deleteEmployee(employeeId: string) {
    const convex = await getAuthedConvexClient();
    return convex.mutation(api.employees.deleteEmployee, {
      employeeId: employeeId as Id<"employees">,
    });
  }

  static async addRequirement(data: {
    employeeId: string;
    requirement: {
      type: string;
      status: "pending" | "submitted" | "verified";
      file?: string;
      submittedDate?: number;
      expiryDate?: number;
      isRequired?: boolean;
      appliesToDepartments?: string[];
      appliesToEmploymentTypes?: string[];
      reminderDaysBeforeDue?: number;
      requiresVerification?: boolean;
    };
  }) {
    const convex = await getAuthedConvexClient();
    return convex.mutation(api.employees.addRequirement, {
      employeeId: data.employeeId as Id<"employees">,
      requirement: {
        ...data.requirement,
        file: data.requirement.file as Id<"_storage"> | undefined,
      },
    });
  }

  static async updateRequirementStatus(data: {
    employeeId: string;
    requirementIndex: number;
    status: "pending" | "submitted" | "verified";
    verificationNotes?: string;
    rejectionReason?: string;
  }) {
    const convex = await getAuthedConvexClient();
    return convex.mutation(api.employees.updateRequirementStatus, {
      employeeId: data.employeeId as Id<"employees">,
      requirementIndex: data.requirementIndex,
      status: data.status,
      verificationNotes: data.verificationNotes,
      rejectionReason: data.rejectionReason,
    });
  }

  static async setEmployeeRequirementsComplete(data: {
    employeeId: string;
    complete: boolean;
  }) {
    const convex = await getAuthedConvexClient();
    return convex.mutation(api.employees.setEmployeeRequirementsComplete, {
      employeeId: data.employeeId as Id<"employees">,
      complete: data.complete,
    });
  }

  static async updateRequirementFile(data: {
    employeeId: string;
    requirementIndex: number;
    file: string;
  }) {
    const convex = await getAuthedConvexClient();
    return convex.mutation(api.employees.updateRequirementFile, {
      employeeId: data.employeeId as Id<"employees">,
      requirementIndex: data.requirementIndex,
      file: data.file as Id<"_storage">,
    });
  }

  static async removeRequirement(data: {
    employeeId: string;
    requirementIndex: number;
  }) {
    const convex = await getAuthedConvexClient();
    return convex.mutation(api.employees.removeRequirement, {
      employeeId: data.employeeId as Id<"employees">,
      requirementIndex: data.requirementIndex,
    });
  }

  static async getEmployeeRequirements(employeeId: string) {
    const convex = await getAuthedConvexClient();
    const employee = await convex.query(api.employees.getEmployee, {
      employeeId: employeeId as Id<"employees">,
    });

    return employee?.requirements || [];
  }
}
