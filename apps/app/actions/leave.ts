"use server";

import type { Id } from "@/convex/_generated/dataModel";
import {
  LeaveService,
  type LeaveRequestDraftInput,
  type LeaveRequestSubmissionInput,
  type LegacyLeaveRequestInput,
} from "@/services/leave-service";

export const previewLeaveRequest = async (input: LeaveRequestDraftInput) =>
  LeaveService.previewLeaveRequest(input);

export const submitLeaveRequest = async (input: LeaveRequestSubmissionInput) =>
  LeaveService.submitLeaveRequest(input);

export const approveLeaveRequestV2 = async (input: {
  leaveRequestId: Id<"leaveRequests">;
  decisionReason?: string;
}) => LeaveService.approveLeaveRequest(input);

export const rejectLeaveRequestV2 = async (input: {
  leaveRequestId: Id<"leaveRequests">;
  decisionReason: string;
}) => LeaveService.rejectLeaveRequest(input);

export const requestLeaveCancellation = async (input: {
  leaveRequestId: Id<"leaveRequests">;
  reason: string;
}) => LeaveService.requestLeaveCancellation(input);

export const approveLeaveCancellation = async (input: {
  leaveRequestId: Id<"leaveRequests">;
  reason: string;
}) => LeaveService.approveLeaveCancellation(input);

export const adjustLeaveBalance = async (input: {
  balanceId: Id<"employeeLeaveBalances">;
  amount: number;
  effectiveDate: number;
  reason: string;
}) => LeaveService.adjustLeaveBalance(input);

export const requestLeaveConversion = async (input: {
  organizationId: Id<"organizations">;
  balanceId: Id<"employeeLeaveBalances">;
  policyId?: Id<"leavePolicies">;
  requestedDays: number;
}) => LeaveService.requestLeaveConversion(input);

export const createLeaveRequest = async (data: LegacyLeaveRequestInput) =>
  LeaveService.createLegacyLeaveRequest(data);

export const approveLeaveRequest = async (
  leaveRequestId: string,
  remarks: string | undefined,
  approvedByName: string,
  reviewerSignatureDataUrl: string,
  reviewerPosition?: string,
) =>
  LeaveService.approveLegacyLeaveRequest(
    leaveRequestId,
    remarks,
    approvedByName,
    reviewerSignatureDataUrl,
    reviewerPosition,
  );

export const rejectLeaveRequest = async (leaveRequestId: string, remarks: string) =>
  LeaveService.rejectLegacyLeaveRequest(leaveRequestId, remarks);

export const cancelLeaveRequest = async (leaveRequestId: string) =>
  LeaveService.cancelLegacyLeaveRequest(leaveRequestId);

export const getLeaveRequest = async (leaveRequestId: string) =>
  LeaveService.getLeaveRequest(leaveRequestId);

export const getEmployeeLeaveCredits = async (
  organizationId: string,
  employeeId: string,
) => LeaveService.getEmployeeLeaveCredits(organizationId, employeeId);

export const updateEmployeeLeaveCredits = async (
  data: Parameters<typeof LeaveService.updateEmployeeLeaveCredits>[0],
) => LeaveService.updateEmployeeLeaveCredits(data);

export const convertLeaveToCash = async (
  data: Parameters<typeof LeaveService.convertLeaveToCash>[0],
) => LeaveService.convertLeaveToCash(data);
