import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { getAuthedConvexClient } from "@/lib/convex-client";

export class AttendanceService {
  static async createAttendance(data: {
    organizationId: string;
    employeeId: string;
    date: number;
    scheduleIn: string;
    scheduleOut: string;
    actualIn?: string;
    actualOut?: string;
    overtime?: number;
    late?: number; // Manual override for late (minutes)
    undertime?: number; // Manual override for undertime (hours)
    isHoliday?: boolean;
    holidayType?: "regular" | "special" | "special_working";
    remarks?: string;
    status:
      | "present"
      | "absent"
      | "half-day"
      | "leave"
      | "leave_with_pay"
      | "leave_without_pay"
      | "no_work";
    overwriteAttendanceId?: string;
    correctionReason?: string;
  }) {
    const convex = await getAuthedConvexClient();
    return await convex.mutation(
      api.attendance.createAttendance,
      {
        ...data,
        organizationId: data.organizationId as Id<"organizations">,
        employeeId: data.employeeId as Id<"employees">,
        overwriteAttendanceId: data.overwriteAttendanceId
          ? (data.overwriteAttendanceId as Id<"attendance">)
          : undefined,
      },
    );
  }

  static async updateAttendance(
    attendanceId: string,
    data: {
      scheduleIn?: string;
      scheduleOut?: string;
      actualIn?: string;
      actualOut?: string;
      overtime?: number;
      late?: number | null; // Manual override for late (minutes), or null to recalculate
      undertime?: number | null; // Manual override for undertime (hours), or null to recalculate
      isHoliday?: boolean;
      holidayType?: "regular" | "special" | "special_working";
      remarks?: string;
      status?:
        | "present"
        | "absent"
        | "half-day"
        | "leave"
        | "leave_with_pay"
        | "leave_without_pay"
        | "no_work";
      correctionReason?: string;
    },
  ) {
    const convex = await getAuthedConvexClient();
    return await convex.mutation(
      api.attendance.updateAttendance,
      {
        attendanceId: attendanceId as Id<"attendance">,
        ...data,
      },
    );
  }

  static async deleteAttendance(
    attendanceId: string,
    correctionReason?: string,
  ) {
    const convex = await getAuthedConvexClient();
    return convex.mutation(api.attendance.deleteAttendance, {
      attendanceId: attendanceId as Id<"attendance">,
      correctionReason,
    });
  }

  static async bulkCreateAttendance(
    entries: Array<{
      organizationId: string;
      employeeId: string;
      date: number;
      scheduleIn: string;
      scheduleOut: string;
      actualIn?: string;
      actualOut?: string;
      overtime?: number;
      late?: number; // Manual override for late (minutes)
      undertime?: number; // Manual override for undertime (hours)
      isHoliday?: boolean;
      holidayType?: "regular" | "special" | "special_working";
      remarks?: string;
      importKey?: string;
      status:
        | "present"
        | "absent"
        | "half-day"
        | "leave"
        | "leave_with_pay"
        | "leave_without_pay"
        | "no_work";
      overwriteAttendanceId?: string;
    }>,
    correctionReason?: string,
  ) {
    const convex = await getAuthedConvexClient();
    return await convex.mutation(
      api.attendance.bulkCreateAttendance,
      {
        correctionReason,
        entries: entries.map((e) => ({
          ...e,
          organizationId: e.organizationId as Id<"organizations">,
          employeeId: e.employeeId as Id<"employees">,
          overwriteAttendanceId: e.overwriteAttendanceId
            ? (e.overwriteAttendanceId as Id<"attendance">)
            : undefined,
        })),
      },
    );
  }

  static async recalculateEmployeeAttendance(data: {
    organizationId: string;
    employeeId: string;
    startDate?: number;
    endDate?: number;
    correctionReason?: string;
  }) {
    const convex = await getAuthedConvexClient();
    let cursor: string | undefined;
    let updated = 0;
    do {
      const result = await convex.mutation(
        api.attendance.recalculateEmployeeAttendance,
        {
          organizationId: data.organizationId as Id<"organizations">,
          employeeId: data.employeeId as Id<"employees">,
          startDate: data.startDate,
          endDate: data.endDate,
          correctionReason: data.correctionReason,
          cursor,
        },
      );
      updated += result.updated;
      cursor = result.isDone ? undefined : result.continueCursor;
      if (result.isDone) return { updated };
    } while (cursor);
    return { updated };
  }

  static async punchSelfAttendance(data: {
    organizationId: string;
    action: "in" | "out";
  }) {
    const convex = await getAuthedConvexClient();
    return await convex.mutation(
      api.attendance.punchSelfAttendance,
      {
        organizationId: data.organizationId as Id<"organizations">,
        action: data.action,
      },
    );
  }
}
