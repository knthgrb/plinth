import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { getAuthedConvexClient } from "@/lib/convex-client";

export class EmployeesService {
  static async createEmployee(data: {
    organizationId: string;
    personalInfo: {
      firstName: string;
      lastName: string;
      middleName?: string;
      email: string;
      phone?: string;
      address?: string;
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
      status: "active" | "inactive" | "resigned" | "terminated";
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
  }) {
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)(
      (api as any).employees.createEmployee,
      {
        ...data,
        organizationId: data.organizationId as Id<"organizations">,
        personalInfo: {
          ...data.personalInfo,
        },
        employment: {
          ...data.employment,
        },
        compensation: {
          ...data.compensation,
        },
        schedule: {
          ...data.schedule,
        },
      }
    );
  }

  static async updateEmployee(
    employeeId: string,
    data: {
      personalInfo?: {
        firstName?: string;
        lastName?: string;
        middleName?: string;
        email?: string;
        phone?: string;
        address?: string;
        dateOfBirth?: number;
        civilStatus?: string;
        emergencyContact?: {
          name: string;
          relationship: string;
          phone: string;
        };
      };
      employment?: {
        employeeId?: string;
        position?: string;
        department?: string;
        employmentType?:
          | "regular"
          | "probationary"
          | "contractual"
          | "part-time";
        hireDate?: number;
        regularizationDate?: number;
        status?: "active" | "inactive" | "resigned" | "terminated";
      };
      compensation?: {
        basicSalary?: number;
        allowance?: number;
        salaryType?: "monthly" | "daily" | "hourly";
        bankDetails?: {
          bankName: string;
          accountNumber: string;
          accountName: string;
        };
        regularHolidayRate?: number;
        specialHolidayRate?: number;
      };
      schedule?: {
        defaultSchedule?: {
          monday?: { in: string; out: string; isWorkday: boolean };
          tuesday?: { in: string; out: string; isWorkday: boolean };
          wednesday?: { in: string; out: string; isWorkday: boolean };
          thursday?: { in: string; out: string; isWorkday: boolean };
          friday?: { in: string; out: string; isWorkday: boolean };
          saturday?: { in: string; out: string; isWorkday: boolean };
          sunday?: { in: string; out: string; isWorkday: boolean };
        };
        scheduleOverrides?: Array<{
          date: number;
          in: string;
          out: string;
          reason: string;
        }>;
      };
      customFields?: Record<string, any>;
    }
  ) {
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)(
      (api as any).employees.updateEmployee,
      {
        employeeId: employeeId as Id<"employees">,
        ...data,
      }
    );
  }

  static async getEmployee(employeeId: string) {
    const convex = await getAuthedConvexClient();
    return await (convex.query as any)((api as any).employees.getEmployee, {
      employeeId: employeeId as Id<"employees">,
    });
  }

  static async deleteEmployee(employeeId: string) {
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)(
      (api as any).employees.deleteEmployee,
      {
        employeeId: employeeId as Id<"employees">,
      }
    );
  }

  static async addRequirement(data: {
    employeeId: string;
    requirement: {
      type: string;
      status: "pending" | "submitted" | "verified";
      file?: string;
      submittedDate?: number;
      expiryDate?: number;
    };
  }) {
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)(
      (api as any).employees.addRequirement,
      {
        employeeId: data.employeeId as Id<"employees">,
        requirement: {
          ...data.requirement,
          file: data.requirement.file as Id<"_storage"> | undefined,
        },
      }
    );
  }

  static async updateRequirementStatus(data: {
    employeeId: string;
    requirementIndex: number;
    status: "pending" | "submitted" | "verified";
  }) {
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)(
      (api as any).employees.updateRequirementStatus,
      {
        employeeId: data.employeeId as Id<"employees">,
        requirementIndex: data.requirementIndex,
        status: data.status,
      }
    );
  }

  static async updateRequirementFile(data: {
    employeeId: string;
    requirementIndex: number;
    file: string;
  }) {
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)(
      (api as any).employees.updateRequirementFile,
      {
        employeeId: data.employeeId as Id<"employees">,
        requirementIndex: data.requirementIndex,
        file: data.file as Id<"_storage">,
      }
    );
  }

  static async removeRequirement(data: {
    employeeId: string;
    requirementIndex: number;
  }) {
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)(
      (api as any).employees.removeRequirement,
      {
        employeeId: data.employeeId as Id<"employees">,
        requirementIndex: data.requirementIndex,
      }
    );
  }

  static async getEmployeeRequirements(employeeId: string) {
    const convex = await getAuthedConvexClient();
    const employee = await (convex.query as any)(
      (api as any).employees.getEmployee,
      {
        employeeId: employeeId as Id<"employees">,
      }
    );

    return employee?.requirements || [];
  }
}
