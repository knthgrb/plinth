"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Settings } from "lucide-react";
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

interface AdminLeaveHistoryTabProps {
  leaveRequests: any[];
  columns: Column[];
  employees?: any[];
  onManageColumns: () => void;
}

export function AdminLeaveHistoryTab({
  leaveRequests,
  columns,
  employees,
  onManageColumns,
}: AdminLeaveHistoryTabProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Employee Leave History</CardTitle>
          <Button variant="outline" size="sm" onClick={onManageColumns}>
            <Settings className="h-4 w-4 mr-2" />
            Manage Columns
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <DynamicLeaveTable
          leaveRequests={leaveRequests}
          columns={columns}
          employees={employees}
        />
      </CardContent>
    </Card>
  );
}
