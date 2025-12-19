import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { getAuthedConvexClient } from "@/lib/convex-client";

export class SettingsService {
  static async getSettings(organizationId: string) {
    const convex = await getAuthedConvexClient();
    return await (convex.query as any)((api as any).settings.getSettings, {
      organizationId: organizationId as Id<"organizations">,
    });
  }

  static async updatePayrollSettings(data: {
    organizationId: string;
    payrollSettings: {
      nightDiffPercent?: number;
      regularHolidayRate?: number;
      specialHolidayRate?: number;
      overtimeRegularRate?: number;
      overtimeRestDayRate?: number;
    };
  }) {
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)(
      (api as any).settings.updatePayrollSettings,
      {
        organizationId: data.organizationId as Id<"organizations">,
        payrollSettings: data.payrollSettings,
      }
    );
  }

  static async updateLeaveTypes(data: {
    organizationId: string;
    leaveTypes: Array<{
      type: string;
      name: string;
      defaultCredits: number;
      isPaid: boolean;
      requiresApproval: boolean;
      maxConsecutiveDays?: number;
      carryOver?: boolean;
      maxCarryOver?: number;
    }>;
  }) {
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)(
      (api as any).settings.updateLeaveTypes,
      {
        organizationId: data.organizationId as Id<"organizations">,
        leaveTypes: data.leaveTypes,
      }
    );
  }

  static async updateDepartments(data: {
    organizationId: string;
    departments: string[];
  }) {
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)(
      (api as any).settings.updateDepartments,
      {
        organizationId: data.organizationId as Id<"organizations">,
        departments: data.departments,
      }
    );
  }

  static async updateEvaluationColumns(data: {
    organizationId: string;
    columns: Array<{
      id: string;
      label: string;
      type: "date" | "number" | "text" | "rating";
      hidden?: boolean;
      hasRatingColumn?: boolean;
      hasNotesColumn?: boolean;
    }>;
  }) {
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)(
      (api as any).settings.updateEvaluationColumns,
      {
        organizationId: data.organizationId as Id<"organizations">,
        columns: data.columns,
      }
    );
  }
}
