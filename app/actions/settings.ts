"use server";

import { SettingsService } from "@/services/settings-service";

export async function getSettings(organizationId: string) {
  return SettingsService.getSettings(organizationId);
}

export async function updateDepartments(data: {
  organizationId: string;
  departments: string[];
}) {
  return SettingsService.updateDepartments(data);
}

export async function updatePayrollSettings(data: {
  organizationId: string;
  payrollSettings: {
    nightDiffPercent?: number;
    regularHolidayRate?: number;
    specialHolidayRate?: number;
    overtimeRegularRate?: number;
    overtimeRestDayRate?: number;
  };
}) {
  return SettingsService.updatePayrollSettings(data);
}

export async function updateLeaveTypes(data: {
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
  return SettingsService.updateLeaveTypes(data);
}

export async function updateEvaluationColumns(data: {
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
  return SettingsService.updateEvaluationColumns(data);
}
