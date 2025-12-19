"use server";

import { AttendanceService } from "@/services/attendance-service";

export async function createAttendance(data: {
  organizationId: string;
  employeeId: string;
  date: number;
  scheduleIn: string;
  scheduleOut: string;
  actualIn?: string;
  actualOut?: string;
  overtime?: number;
  isHoliday?: boolean;
  holidayType?: "regular" | "special";
  remarks?: string;
  status: "present" | "absent" | "half-day" | "leave";
}) {
  return AttendanceService.createAttendance(data);
}

export async function updateAttendance(
  attendanceId: string,
  data: {
    scheduleIn?: string;
    scheduleOut?: string;
    actualIn?: string;
    actualOut?: string;
    overtime?: number;
    isHoliday?: boolean;
    holidayType?: "regular" | "special";
    remarks?: string;
    status?: "present" | "absent" | "half-day" | "leave";
  }
) {
  return AttendanceService.updateAttendance(attendanceId, data);
}

export async function deleteAttendance(attendanceId: string) {
  return AttendanceService.deleteAttendance(attendanceId);
}

export async function bulkCreateAttendance(
  entries: Array<{
    organizationId: string;
    employeeId: string;
    date: number;
    scheduleIn: string;
    scheduleOut: string;
    actualIn?: string;
    actualOut?: string;
    overtime?: number;
    isHoliday?: boolean;
    holidayType?: "regular" | "special";
    remarks?: string;
    status: "present" | "absent" | "half-day" | "leave";
  }>
) {
  return AttendanceService.bulkCreateAttendance(entries);
}
