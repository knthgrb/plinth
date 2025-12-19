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
    <Card>
      <CardHeader>
        <CardTitle>Leave History</CardTitle>
      </CardHeader>
      <CardContent>
        <DynamicLeaveTable leaveRequests={leaveHistory} columns={columns} />
      </CardContent>
    </Card>
  );
}
