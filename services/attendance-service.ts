import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { getAuthedConvexClient } from "@/lib/convex-client";
import { getToken } from "@/lib/auth-server";

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
    isHoliday?: boolean;
    holidayType?: "regular" | "special";
    remarks?: string;
    status: "present" | "absent" | "half-day" | "leave";
  }) {
    const token = await getToken();
    if (!token) throw new Error("Not authenticated");

    const convex = await getAuthedConvexClient();
    return await (convex.action as any)(
      (api as any).attendance.createAttendance,
      {
        ...data,
        organizationId: data.organizationId as Id<"organizations">,
        employeeId: data.employeeId as Id<"employees">,
      },
      { token }
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
      isHoliday?: boolean;
      holidayType?: "regular" | "special";
      remarks?: string;
      status?: "present" | "absent" | "half-day" | "leave";
    }
  ) {
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)(
      (api as any).attendance.updateAttendance,
      {
        attendanceId: attendanceId as Id<"attendance">,
        ...data,
      }
    );
  }

  static async deleteAttendance(attendanceId: string) {
    // Note: Add deleteAttendance mutation to convex/attendance.ts if needed
    // For now, we'll return an error indicating it needs to be implemented
    throw new Error("Delete attendance not yet implemented");
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
      isHoliday?: boolean;
      holidayType?: "regular" | "special";
      remarks?: string;
      status: "present" | "absent" | "half-day" | "leave";
    }>
  ) {
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)(
      (api as any).attendance.bulkCreateAttendance,
      {
        entries: entries.map((e: any) => ({
          ...e,
          organizationId: e.organizationId as Id<"organizations">,
          employeeId: e.employeeId as Id<"employees">,
        })),
      }
    );
  }
}
