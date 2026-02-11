"use client";

import { useState, useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { MainLayout } from "@/components/layout/main-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { useOrganization } from "@/hooks/organization-context";
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  addDays,
  addMonths,
  subMonths,
  isSameMonth,
  isToday,
  getYear,
  getMonth,
} from "date-fns";

type Holiday = {
  _id: string;
  name: string;
  date: number;
  type: "regular" | "special";
  isRecurring: boolean;
  year?: number;
};

/** Get display date for a holiday in a given year (recurring = same month/day in that year) */
function holidayDateInYear(h: Holiday, year: number): Date {
  const d = new Date(h.date);
  if (h.isRecurring) {
    return new Date(year, d.getMonth(), d.getDate());
  }
  return d;
}

export default function CalendarPage() {
  const { currentOrganizationId } = useOrganization();
  const [viewDate, setViewDate] = useState(() => new Date());

  const year = getYear(viewDate);
  const holidays = useQuery(
    (api as any).holidays.getHolidays,
    currentOrganizationId ? { organizationId: currentOrganizationId, year } : "skip"
  );

  // Map: "YYYY-MM-DD" -> list of holidays on that day (for viewed month, recurring projected to view year)
  const holidaysByDay = useMemo(() => {
    const map: Record<string, Holiday[]> = {};
    if (!holidays) return map;
    const viewMonth = getMonth(viewDate);
    holidays.forEach((h: Holiday) => {
      const d = holidayDateInYear(h, year);
      if (getMonth(d) !== viewMonth) return;
      const key = format(d, "yyyy-MM-dd");
      if (!map[key]) map[key] = [];
      map[key].push(h);
    });
    return map;
  }, [holidays, viewDate, year]);

  // Calendar grid: weeks that touch the current month
  const calendarDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(viewDate), { weekStartsOn: 0 });
    const end = endOfWeek(endOfMonth(viewDate), { weekStartsOn: 0 });
    const days: Date[] = [];
    let d = start;
    while (d <= end) {
      days.push(d);
      d = addDays(d, 1);
    }
    return days;
  }, [viewDate]);

  const prevMonth = () => setViewDate((d) => subMonths(d, 1));
  const nextMonth = () => setViewDate((d) => addMonths(d, 1));

  const weekDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <MainLayout>
      <div className="p-4 md:p-6 max-w-6xl mx-auto">
        <Card className="overflow-hidden border-[rgb(230,230,230)] shadow-sm">
          <CardHeader className="pb-2 border-b border-[rgb(240,240,240)] bg-gradient-to-b from-[rgb(252,252,252)] to-white">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex items-center gap-2">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-purple/10">
                  <CalendarDays className="h-5 w-5 text-brand-purple" />
                </div>
                <div>
                  <CardTitle className="text-xl font-semibold text-[rgb(40,40,40)]">
                    Organization Calendar
                  </CardTitle>
                  <p className="text-sm text-[rgb(120,120,120)] mt-0.5">
                    Holidays and events for your reference
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={prevMonth}
                  className="shrink-0 border-[rgb(220,220,220)] hover:bg-[rgb(248,248,248)]"
                  aria-label="Previous month"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="min-w-[180px] text-center font-semibold text-[rgb(50,50,50)]">
                  {format(viewDate, "MMMM yyyy")}
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={nextMonth}
                  className="shrink-0 border-[rgb(220,220,220)] hover:bg-[rgb(248,248,248)]"
                  aria-label="Next month"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
            {/* Legend */}
            <div className="flex flex-wrap gap-4 pt-3 mt-2 border-t border-[rgb(242,242,242)]">
              <div className="flex items-center gap-2">
                <span
                  className="inline-block h-3 w-3 rounded-full bg-rose-500"
                  aria-hidden
                />
                <span className="text-xs font-medium text-[rgb(100,100,100)]">
                  Regular holiday
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className="inline-block h-3 w-3 rounded-full bg-amber-500"
                  aria-hidden
                />
                <span className="text-xs font-medium text-[rgb(100,100,100)]">
                  Special holiday
                </span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {/* Weekday headers */}
            <div className="grid grid-cols-7 border-b border-[rgb(238,238,238)] bg-[rgb(250,250,250)]">
              {weekDays.map((day) => (
                <div
                  key={day}
                  className="py-2.5 text-center text-xs font-semibold uppercase tracking-wide text-[rgb(100,100,100)]"
                >
                  {day}
                </div>
              ))}
            </div>
            {/* Calendar grid */}
            <div className="grid grid-cols-7 min-h-[420px]">
              {calendarDays.map((day) => {
                const key = format(day, "yyyy-MM-dd");
                const dayHolidays = holidaysByDay[key] ?? [];
                const inMonth = isSameMonth(day, viewDate);
                const today = isToday(day);

                return (
                  <div
                    key={key}
                    className={`
                      min-h-[100px] border-r border-b border-[rgb(238,238,238)] p-1.5
                      ${inMonth ? "bg-white" : "bg-[rgb(252,252,252)]"}
                    `}
                  >
                    <div
                      className={`
                        flex h-7 w-7 items-center justify-center rounded-full text-sm font-medium
                        ${!inMonth ? "text-[rgb(180,180,180)]" : "text-[rgb(50,50,50)]"}
                        ${today ? "bg-brand-purple text-white" : ""}
                      `}
                    >
                      {format(day, "d")}
                    </div>
                    <div className="mt-1 space-y-1 overflow-hidden">
                      {dayHolidays.map((h) => (
                        <div
                          key={h._id}
                          className="group relative"
                          title={`${h.name} (${h.type === "regular" ? "Regular" : "Special"} holiday)`}
                        >
                          <Badge
                            variant="secondary"
                            className={`
                              w-full justify-start truncate text-[10px] font-medium py-0.5 px-1.5 border-0
                              ${h.type === "regular" ? "bg-rose-100 text-rose-800 hover:bg-rose-100" : "bg-amber-100 text-amber-800 hover:bg-amber-100"}
                            `}
                          >
                            <span className="truncate block">{h.name}</span>
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {holidays && holidays.length === 0 && (
          <p className="text-center text-sm text-[rgb(120,120,120)] mt-4">
            No holidays configured for this year. HR can add them in Settings → Holidays.
          </p>
        )}
      </div>
    </MainLayout>
  );
}
