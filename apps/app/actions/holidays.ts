"use server";

import { HolidaysService } from "@/services/holidays-service";

export async function bulkCreateHolidays(data: {
  organizationId: string;
  holidays: Array<{
    name: string;
    date: number;
    type: "regular" | "special";
    isRecurring: boolean;
    year?: number;
  }>;
}) {
  return HolidaysService.bulkCreateHolidays(data);
}

export async function createHoliday(data: {
  organizationId: string;
  name: string;
  date: number;
  type: "regular" | "special";
  isRecurring: boolean;
  year?: number;
}) {
  return HolidaysService.createHoliday(data);
}

export async function updateHoliday(
  holidayId: string,
  data: {
    name?: string;
    date?: number;
    type?: "regular" | "special";
    isRecurring?: boolean;
    year?: number;
  }
) {
  return HolidaysService.updateHoliday(holidayId, data);
}

export async function deleteHoliday(holidayId: string) {
  return HolidaysService.deleteHoliday(holidayId);
}

export async function initializePhilippineHolidays(organizationId: string) {
  return HolidaysService.initializePhilippineHolidays(organizationId);
}
