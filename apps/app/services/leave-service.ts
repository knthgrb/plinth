import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getAuthedConvexClient } from "@/lib/convex-client";

export interface LeaveRequestDraftInput {
  organizationId: Id<"organizations">;
  employeeId: Id<"employees">;
  policyId: Id<"leavePolicies">;
  startLocalDate: string;
  endLocalDate: string;
  requestedDurationMode: "day" | "half_day" | "hour";
  requestedMinutes?: number;
  benefitEventId?: Id<"leaveBenefitEvents">;
}

export interface LeaveRequestSubmissionInput extends LeaveRequestDraftInput {
  reason: string;
  attachments?: Array<{
    storageObjectId: Id<"storageObjects">;
    documentType: string;
  }>;
}

export interface LegacyLeaveRequestInput {
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
  isPaid?: boolean;
}

export class LeaveService {
  static async previewLeaveRequest(input: LeaveRequestDraftInput) {
    const convex = await getAuthedConvexClient();
    return convex.query(api.leave.previewLeaveRequestV2, input);
  }

  static async submitLeaveRequest(input: LeaveRequestSubmissionInput) {
    const convex = await getAuthedConvexClient();
    return convex.mutation(api.leave.createLeaveRequestV2, input);
  }

  static async approveLeaveRequest(input: {
    leaveRequestId: Id<"leaveRequests">;
    decisionReason?: string;
  }) {
    const convex = await getAuthedConvexClient();
    return convex.mutation(api.leave.approveLeaveRequestV2, input);
  }

  static async rejectLeaveRequest(input: {
    leaveRequestId: Id<"leaveRequests">;
    decisionReason: string;
  }) {
    const convex = await getAuthedConvexClient();
    return convex.mutation(api.leave.rejectLeaveRequestV2, input);
  }

  static async requestLeaveCancellation(input: {
    leaveRequestId: Id<"leaveRequests">;
    reason: string;
  }) {
    const convex = await getAuthedConvexClient();
    return convex.mutation(api.leave.requestApprovedLeaveCancellation, input);
  }

  static async approveLeaveCancellation(input: {
    leaveRequestId: Id<"leaveRequests">;
    reason: string;
  }) {
    const convex = await getAuthedConvexClient();
    return convex.mutation(api.leave.approveLeaveCancellation, input);
  }

  static async adjustLeaveBalance(input: {
    balanceId: Id<"employeeLeaveBalances">;
    amount: number;
    effectiveDate: number;
    reason: string;
  }) {
    const convex = await getAuthedConvexClient();
    return convex.mutation(api.leave.adjustLeaveBalance, input);
  }

  static async requestLeaveConversion(input: {
    organizationId: Id<"organizations">;
    balanceId: Id<"employeeLeaveBalances">;
    policyId?: Id<"leavePolicies">;
    requestedDays: number;
  }) {
    const convex = await getAuthedConvexClient();
    return convex.mutation(api.leaveConversions.requestLeaveConversion, input);
  }

  static async createLegacyLeaveRequest(data: LegacyLeaveRequestInput) {
    const convex = await getAuthedConvexClient();
    return convex.mutation(api.leave.createLeaveRequest, {
      ...data,
      organizationId: data.organizationId as Id<"organizations">,
      employeeId: data.employeeId as Id<"employees">,
      supportingDocuments: data.supportingDocuments as
        | Id<"_storage">[]
        | undefined,
    });
  }

  static async approveLegacyLeaveRequest(
    leaveRequestId: string,
    remarks: string | undefined,
    approvedByName: string,
    reviewerSignatureDataUrl: string,
    reviewerPosition?: string,
  ) {
    const convex = await getAuthedConvexClient();
    return convex.mutation(api.leave.approveLeaveRequest, {
      leaveRequestId: leaveRequestId as Id<"leaveRequests">,
      remarks,
      approvedByName,
      reviewerSignatureDataUrl,
      reviewerPosition: reviewerPosition?.trim() || undefined,
    });
  }

  static async rejectLegacyLeaveRequest(leaveRequestId: string, remarks: string) {
    const convex = await getAuthedConvexClient();
    return convex.mutation(api.leave.rejectLeaveRequest, {
      leaveRequestId: leaveRequestId as Id<"leaveRequests">,
      remarks,
    });
  }

  static async cancelLegacyLeaveRequest(leaveRequestId: string) {
    const convex = await getAuthedConvexClient();
    return convex.mutation(api.leave.cancelLeaveRequest, {
      leaveRequestId: leaveRequestId as Id<"leaveRequests">,
    });
  }

  static async getLeaveRequest(leaveRequestId: string) {
    const convex = await getAuthedConvexClient();
    return convex.query(api.leave.getLeaveRequest, {
      leaveRequestId: leaveRequestId as Id<"leaveRequests">,
    });
  }

  static async getEmployeeLeaveCredits(
    organizationId: string,
    employeeId: string,
  ) {
    const convex = await getAuthedConvexClient();
    return convex.query(api.leave.getEmployeeLeaveCredits, {
      organizationId: organizationId as Id<"organizations">,
      employeeId: employeeId as Id<"employees">,
    });
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
    return convex.mutation(api.leave.updateEmployeeLeaveCredits, {
      ...data,
      organizationId: data.organizationId as Id<"organizations">,
      employeeId: data.employeeId as Id<"employees">,
    });
  }

  static async convertLeaveToCash(data: {
    organizationId: string;
    employeeId: string;
    leaveType: "vacation" | "sick";
    daysToConvert: number;
    reason?: string;
  }) {
    const convex = await getAuthedConvexClient();
    return convex.mutation(api.leave.convertLeaveToCash, {
      ...data,
      organizationId: data.organizationId as Id<"organizations">,
      employeeId: data.employeeId as Id<"employees">,
    });
  }
}
