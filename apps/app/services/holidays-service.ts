import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { getAuthedConvexClient } from "@/lib/convex-client";
import { getToken } from "@/lib/auth-server";

export class HolidaysService {
  static async bulkCreateHolidays(data: {
    organizationId: string;
    holidays: Array<{
      name: string;
      date: number;
      type: "regular" | "special";
      isRecurring: boolean;
      year?: number;
    }>;
  }) {
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)(
      (api as any).holidays.bulkCreateHolidays,
      {
        organizationId: data.organizationId as Id<"organizations">,
        holidays: data.holidays,
      }
    );
  }

  static async createHoliday(data: {
    organizationId: string;
    name: string;
    date: number;
    type: "regular" | "special";
    isRecurring: boolean;
    year?: number;
  }) {
    const token = await getToken();
    if (!token) throw new Error("Not authenticated");

    const convex = await getAuthedConvexClient();
    return await (convex.action as any)(
      (api as any).holidays.createHoliday,
      {
        ...data,
        organizationId: data.organizationId as Id<"organizations">,
      },
      { token }
    );
  }

  static async updateHoliday(
    holidayId: string,
    data: {
      name?: string;
      date?: number;
      type?: "regular" | "special";
      isRecurring?: boolean;
      year?: number;
    }
  ) {
    const token = await getToken();
    if (!token) throw new Error("Not authenticated");

    const convex = await getAuthedConvexClient();
    return await (convex.action as any)(
      (api as any).holidays.updateHoliday,
      {
        holidayId: holidayId as Id<"holidays">,
        ...data,
      },
      { token }
    );
  }

  static async deleteHoliday(holidayId: string) {
    const token = await getToken();
    if (!token) throw new Error("Not authenticated");

    const convex = await getAuthedConvexClient();
    return await (convex.action as any)(
      (api as any).holidays.deleteHoliday,
      {
        holidayId: holidayId as Id<"holidays">,
      },
      { token }
    );
  }

  static async initializePhilippineHolidays(organizationId: string) {
    const token = await getToken();
    if (!token) throw new Error("Not authenticated");

    const convex = await getAuthedConvexClient();
    return await (convex.action as any)(
      (api as any).holidays.initializePhilippineHolidays,
      {
        organizationId: organizationId as Id<"organizations">,
      },
      { token }
    );
  }
}
