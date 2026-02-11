"use server";

import { LeaveService } from "@/services/leave-service";

export async function createLeaveRequest(data: {
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
  return LeaveService.createLeaveRequest(data);
}

export async function approveLeaveRequest(
  leaveRequestId: string,
  remarks?: string
) {
  return LeaveService.approveLeaveRequest(leaveRequestId, remarks);
}

export async function rejectLeaveRequest(
  leaveRequestId: string,
  remarks: string
) {
  return LeaveService.rejectLeaveRequest(leaveRequestId, remarks);
}

export async function cancelLeaveRequest(leaveRequestId: string) {
  return LeaveService.cancelLeaveRequest(leaveRequestId);
}

export async function getLeaveRequest(leaveRequestId: string) {
  return LeaveService.getLeaveRequest(leaveRequestId);
}

export async function getEmployeeLeaveCredits(
  organizationId: string,
  employeeId: string
) {
  return LeaveService.getEmployeeLeaveCredits(organizationId, employeeId);
}

export async function updateEmployeeLeaveCredits(data: {
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
  return LeaveService.updateEmployeeLeaveCredits(data);
}

export async function convertLeaveToCash(data: {
  organizationId: string;
  employeeId: string;
  leaveType: "vacation" | "sick";
  daysToConvert: number;
  reason?: string;
}) {
  return LeaveService.convertLeaveToCash(data);
}
