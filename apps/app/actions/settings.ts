"use server";

import { SettingsService } from "@/services/settings-service";

export async function getSettings(organizationId: string) {
  return SettingsService.getSettings(organizationId);
}

export async function updateDepartments(data: {
  organizationId: string;
  departments: Array<string | { name: string; color?: string }>;
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
  proratedLeave?: boolean;
  annualSil?: number;
  grantLeaveUponRegularization?: boolean;
  leaveRequestFormTemplate?: string;
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
