"use client";

import { useQuery } from "convex/react";
import { format } from "date-fns";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSeparationTypeLabel } from "@/utils/employment-lifecycle";

const EVENT_LABELS = {
  hired: "Hired",
  separated: "Separated",
  resigned: "Resigned",
  terminated: "Terminated",
  rehired: "Rehired",
} as const;

export function EmployeeLifecycleTimeline({
  employeeId,
}: {
  employeeId: Id<"employees">;
}) {
  const events = useQuery(api.employees.getEmployeeLifecycleTimeline, {
    employeeId,
  });

  return (
    <Card className="border-gray-100">
      <CardHeader className="py-2.5 px-3 sm:px-4">
        <CardTitle className="text-sm font-medium">
          Employment timeline
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 px-3 sm:px-4 pb-4">
        {!events ? (
          <p className="text-sm text-muted-foreground">Loading history…</p>
        ) : (
          <ol className="relative ml-2 border-l space-y-4">
            {events.map((event) => (
              <li key={event._id} className="ml-4">
                <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border bg-background" />
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-medium">
                    {event.type === "separated" && event.separationType
                      ? getSeparationTypeLabel(event.separationType)
                      : EVENT_LABELS[event.type]}
                  </p>
                  <time className="text-xs text-muted-foreground">
                    {format(new Date(event.effectiveAt), "MMM d, yyyy")}
                  </time>
                </div>
                <p className="text-xs text-muted-foreground">
                  {event.position} · {event.department}
                </p>
                {event.reason && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {event.reason}
                  </p>
                )}
                <p className="text-[11px] text-muted-foreground mt-1">
                  Recorded by{" "}
                  {event.recordedBy?.name ||
                    event.recordedBy?.email ||
                    "system"}
                </p>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
