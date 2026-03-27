import { format } from "date-fns";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import {
  generateLeaveRequestApprovedEmail,
  generateLeaveRequestRejectedEmail,
} from "@/helpers/email-templates";
import { getAuthedConvexClient } from "@/lib/convex-client";
import { sendEmail } from "@/lib/email";
import { GENERAL_LEAVE_CREDIT_KEY } from "@/lib/leave-constants";
import { EmployeesService } from "@/services/employees-service";

export class LeaveService {
  private static leaveTypeLabel(leave: {
    leaveType: string;
    customLeaveType?: string;
  }): string {
    if (
      leave.leaveType === "custom" &&
      leave.customLeaveType === GENERAL_LEAVE_CREDIT_KEY
    ) {
      return "Annual leave";
    }
    return leave.customLeaveType || leave.leaveType;
  }

  private static async notifyEmployeeLeaveApproved(leaveRequestId: string) {
    try {
      const leave = await this.getLeaveRequest(leaveRequestId);
      if (!leave || leave.status !== "approved") return;

      const employee = await EmployeesService.getEmployee(leave.employeeId);
      const to = employee?.personalInfo?.email?.trim();
      if (!to) {
        console.warn(
          `[leave] Skipping approval email: no email for employee ${leave.employeeId}`,
        );
        return;
      }

      const convex = await getAuthedConvexClient();
      const org = await (convex.query as any)(
        (api as any).organizations.getOrganization,
        { organizationId: leave.organizationId },
      );
      const organizationName = org?.name ?? "Your organization";
      const firstName = employee.personalInfo?.firstName?.trim() || "there";

      const baseUrl =
        process.env.NEXT_PUBLIC_SITE_URL ||
        process.env.SITE_URL ||
        "http://localhost:3000";
      const leavePageUrl = `${baseUrl.replace(/\/$/, "")}/${leave.organizationId}/leave`;

      const periodLabel = `${format(new Date(leave.startDate), "MMM d, yyyy")} - ${format(new Date(leave.endDate), "MMM d, yyyy")}`;

      const content = generateLeaveRequestApprovedEmail({
        employeeFirstName: firstName,
        organizationName,
        leaveTypeLabel: this.leaveTypeLabel(leave),
        periodLabel,
        numberOfDays: leave.numberOfDays,
        reason: leave.reason,
        reviewerRemarks: leave.remarks,
        approvedByName: leave.approvedByName,
        leavePageUrl,
      });

      await sendEmail({
        to,
        subject: content.subject,
        html: content.html,
        text: content.text,
      });
    } catch (err) {
      console.error("[leave] Failed to send approval email:", err);
    }
  }

  private static async notifyEmployeeLeaveRejected(leaveRequestId: string) {
    try {
      const leave = await this.getLeaveRequest(leaveRequestId);
      if (!leave || leave.status !== "rejected") return;

      const employee = await EmployeesService.getEmployee(leave.employeeId);
      const to = employee?.personalInfo?.email?.trim();
      if (!to) {
        console.warn(
          `[leave] Skipping rejection email: no email for employee ${leave.employeeId}`,
        );
        return;
      }

      const convex = await getAuthedConvexClient();
      const org = await (convex.query as any)(
        (api as any).organizations.getOrganization,
        { organizationId: leave.organizationId },
      );
      const organizationName = org?.name ?? "Your organization";
      const firstName = employee.personalInfo?.firstName?.trim() || "there";

      const baseUrl =
        process.env.NEXT_PUBLIC_SITE_URL ||
        process.env.SITE_URL ||
        "http://localhost:3000";
      const leavePageUrl = `${baseUrl.replace(/\/$/, "")}/${leave.organizationId}/leave`;

      const periodLabel = `${format(new Date(leave.startDate), "MMM d, yyyy")} - ${format(new Date(leave.endDate), "MMM d, yyyy")}`;

      const rejectionReason = leave.remarks?.trim() || "No reason was provided.";

      const content = generateLeaveRequestRejectedEmail({
        employeeFirstName: firstName,
        organizationName,
        leaveTypeLabel: this.leaveTypeLabel(leave),
        periodLabel,
        numberOfDays: leave.numberOfDays,
        reason: leave.reason,
        rejectionReason,
        leavePageUrl,
      });

      await sendEmail({
        to,
        subject: content.subject,
        html: content.html,
        text: content.text,
      });
    } catch (err) {
      console.error("[leave] Failed to send rejection email:", err);
    }
  }

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
    formTemplateContent?: string;
    filledFormContent?: string;
    signatureDataUrl?: string;
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
      },
    );
  }

  static async approveLeaveRequest(
    leaveRequestId: string,
    remarks: string | undefined,
    approvedByName: string,
    reviewerSignatureDataUrl: string,
  ) {
    const convex = await getAuthedConvexClient();
    const result = await (convex.mutation as any)(
      (api as any).leave.approveLeaveRequest,
      {
        leaveRequestId: leaveRequestId as Id<"leaveRequests">,
        remarks,
        approvedByName,
        reviewerSignatureDataUrl,
      },
    );
    await LeaveService.notifyEmployeeLeaveApproved(leaveRequestId);
    return result;
  }

  static async rejectLeaveRequest(leaveRequestId: string, remarks: string) {
    const convex = await getAuthedConvexClient();
    const result = await (convex.mutation as any)(
      (api as any).leave.rejectLeaveRequest,
      {
        leaveRequestId: leaveRequestId as Id<"leaveRequests">,
        remarks,
      },
    );
    await LeaveService.notifyEmployeeLeaveRejected(leaveRequestId);
    return result;
  }

  static async cancelLeaveRequest(leaveRequestId: string) {
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)(
      (api as any).leave.cancelLeaveRequest,
      {
        leaveRequestId: leaveRequestId as Id<"leaveRequests">,
      },
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
    employeeId: string,
  ) {
    const convex = await getAuthedConvexClient();
    return await (convex.query as any)(
      (api as any).leave.getEmployeeLeaveCredits,
      {
        organizationId: organizationId as Id<"organizations">,
        employeeId: employeeId as Id<"employees">,
      },
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
      },
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
      },
    );
  }
}
