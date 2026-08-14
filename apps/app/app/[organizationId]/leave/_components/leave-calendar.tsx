"use client";

import { useMemo, useState } from "react";
import { usePaginatedQuery } from "convex/react";
import { CalendarRange } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { buildCalendarRows } from "@/lib/leave/admin-workspace";

function currentManilaMonth(): string {
  const date = new Date(Date.now() + 8 * 60 * 60 * 1_000);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function getMonthRange(month: string): {
  startLocalDate: string;
  endLocalDate: string;
} {
  const [year, monthNumber] = month.split("-").map(Number);
  const finalDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return {
    startLocalDate: `${month}-01`,
    endLocalDate: `${month}-${String(finalDay).padStart(2, "0")}`,
  };
}

export function LeaveCalendar(props: { organizationId: Id<"organizations"> }) {
  const [month, setMonth] = useState(currentManilaMonth);
  const range = getMonthRange(month);
  const calendarResult = usePaginatedQuery(
    api.leave.getApprovedLeaveCalendar,
    { organizationId: props.organizationId, ...range },
    { initialNumItems: 50 },
  );
  const rows = useMemo(
    () =>
      buildCalendarRows(calendarResult.results).sort(
        (left, right) => left.startDate - right.startDate,
      ),
    [calendarResult.results],
  );
  const formatter = new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "Asia/Manila",
  });

  return (
    <Card className="border-[rgb(230,230,230)] shadow-sm">
      <CardHeader className="flex flex-row items-start justify-between space-y-0 border-b">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarRange className="h-5 w-5 text-brand-purple" /> Approved
            absence calendar
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Employee availability without exposing protected leave details.
          </p>
        </div>
        <Input
          type="month"
          value={month}
          onChange={(event) => setMonth(event.target.value)}
          className="w-44"
          aria-label="Calendar month"
        />
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">
            No approved absences begin in this month.
          </p>
        ) : (
          <div className="divide-y">
            {rows.map((row) => (
              <div
                key={row.id}
                className="grid gap-3 p-4 sm:grid-cols-[150px_minmax(0,1fr)_auto] sm:items-center"
              >
                <p className="text-sm font-medium">
                  {formatter.format(row.startDate)}
                  {row.endDate !== row.startDate
                    ? ` – ${formatter.format(row.endDate)}`
                    : ""}
                </p>
                <div>
                  <p className="text-sm font-medium">{row.availabilityLabel}</p>
                  <p className="text-xs text-muted-foreground">
                    {row.reason ?? "Leave reason is not shown"}
                  </p>
                </div>
                <Badge variant="secondary">{row.policyLabel}</Badge>
              </div>
            ))}
          </div>
        )}
        {calendarResult.status === "CanLoadMore" ? (
          <div className="border-t p-4 text-center">
            <Button
              variant="outline"
              onClick={() => calendarResult.loadMore(50)}
            >
              Load more absences
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
