"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DynamicLeaveTable } from "./dynamic-leave-table";

interface Column {
  id: string;
  label: string;
  field: string;
  type: "text" | "number" | "date" | "badge" | "link";
  sortable?: boolean;
  width?: string;
  customField?: boolean;
}

interface EmployeeLeaveHistoryTabProps {
  leaveHistory: any[];
  columns: Column[];
}

export function EmployeeLeaveHistoryTab({
  leaveHistory,
  columns,
}: EmployeeLeaveHistoryTabProps) {
  return (
    <Card className="border-[rgb(230,230,230)] shadow-sm overflow-hidden">
      <CardHeader className="pb-4 pt-6">
        <CardTitle className="text-base font-semibold text-[rgb(64,64,64)]">
          Leave history
        </CardTitle>
        <p className="text-sm text-[rgb(133,133,133)] mt-1">
          Your past and upcoming leave requests.
        </p>
      </CardHeader>
      <CardContent className="pt-0 pb-6">
        <DynamicLeaveTable leaveRequests={leaveHistory} columns={columns} />
      </CardContent>
    </Card>
  );
}
