import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { getAuthedConvexClient } from "@/lib/convex-client";

export class LeaveService {
  static async createLeaveRequest(data: {
    organizationId: string;
    employeeId: string;
    leaveType:
      | "vacation"
      | "sick"
      | "emergency"
      | "maternity"
      | "paternity"
      | "custom";
    customLeaveType?: string;
    startDate: number;
    endDate: number;
    reason: string;
    supportingDocuments?: string[];
  }) {
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)(
      (api as any).leave.createLeaveRequest,
      {
        ...data,
        organizationId: data.organizationId as Id<"organizations">,
        employeeId: data.employeeId as Id<"employees">,
        supportingDocuments: data.supportingDocuments as
          | Id<"_storage">[]
          | undefined,
      }
    );
  }

  static async approveLeaveRequest(leaveRequestId: string, remarks?: string) {
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)(
      (api as any).leave.approveLeaveRequest,
      {
        leaveRequestId: leaveRequestId as Id<"leaveRequests">,
        remarks,
      }
    );
  }

  static async rejectLeaveRequest(leaveRequestId: string, remarks: string) {
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)(
      (api as any).leave.rejectLeaveRequest,
      {
        leaveRequestId: leaveRequestId as Id<"leaveRequests">,
        remarks,
      }
    );
  }

  static async cancelLeaveRequest(leaveRequestId: string) {
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)(
      (api as any).leave.cancelLeaveRequest,
      {
        leaveRequestId: leaveRequestId as Id<"leaveRequests">,
      }
    );
  }

  static async getLeaveRequest(leaveRequestId: string) {
    const convex = await getAuthedConvexClient();
    return await (convex.query as any)((api as any).leave.getLeaveRequest, {
      leaveRequestId: leaveRequestId as Id<"leaveRequests">,
    });
  }

  static async getEmployeeLeaveCredits(
    organizationId: string,
    employeeId: string
  ) {
    const convex = await getAuthedConvexClient();
    return await (convex.query as any)(
      (api as any).leave.getEmployeeLeaveCredits,
      {
        organizationId: organizationId as Id<"organizations">,
        employeeId: employeeId as Id<"employees">,
      }
    );
  }

  static async updateEmployeeLeaveCredits(data: {
    organizationId: string;
    employeeId: string;
    leaveType: "vacation" | "sick" | "custom";
    customType?: string;
    total?: number;
    used?: number;
    balance?: number;
    adjustment?: number;
    reason?: string;
  }) {
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)(
      (api as any).leave.updateEmployeeLeaveCredits,
      {
        organizationId: data.organizationId as Id<"organizations">,
        employeeId: data.employeeId as Id<"employees">,
        leaveType: data.leaveType,
        customType: data.customType,
        total: data.total,
        used: data.used,
        balance: data.balance,
        adjustment: data.adjustment,
        reason: data.reason,
      }
    );
  }

  static async convertLeaveToCash(data: {
    organizationId: string;
    employeeId: string;
    leaveType: "vacation" | "sick";
    daysToConvert: number;
    reason?: string;
  }) {
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)(
      (api as any).leave.convertLeaveToCash,
      {
        organizationId: data.organizationId as Id<"organizations">,
        employeeId: data.employeeId as Id<"employees">,
        leaveType: data.leaveType,
        daysToConvert: data.daysToConvert,
        reason: data.reason,
      }
    );
  }
}
