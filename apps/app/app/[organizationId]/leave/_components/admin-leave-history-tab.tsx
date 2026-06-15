"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Settings } from "lucide-react";
import { DynamicLeaveTable } from "./dynamic-leave-table";
import { ManualLeaveEntryDialog } from "./manual-leave-entry-dialog";

interface Column {
  id: string;
  label: string;
  field: string;
  type: "text" | "number" | "date" | "badge" | "link";
  sortable?: boolean;
  width?: string;
  customField?: boolean;
}

type LeaveHistoryRequest = {
  employeeId: string;
  filedDate?: number;
  [key: string]: unknown;
};

type LeaveHistoryEmployee = {
  _id: string;
  personalInfo?: {
    firstName?: string;
    lastName?: string;
  };
};

interface AdminLeaveHistoryTabProps {
  organizationId: string;
  leaveRequests: LeaveHistoryRequest[];
  columns: Column[];
  employees?: LeaveHistoryEmployee[];
  onManageColumns: () => void;
  configuredLeaveTypes?: Array<{ type: string; name: string; isPaid?: boolean }>;
  cutoffDates?: { firstCutoff?: number; secondCutoff?: number };
  leaveTrackerMode?: "general" | "by_type";
}

export function AdminLeaveHistoryTab({
  organizationId,
  leaveRequests,
  columns,
  employees,
  onManageColumns,
  configuredLeaveTypes = [],
  cutoffDates,
  leaveTrackerMode = "general",
}: AdminLeaveHistoryTabProps) {
  const [employeeFilter, setEmployeeFilter] = useState<string>("all");
  const [isManualDialogOpen, setIsManualDialogOpen] = useState(false);

  const filteredRequests = useMemo(() => {
    if (employeeFilter === "all") return leaveRequests;
    return leaveRequests.filter((request) => request.employeeId === employeeFilter);
  }, [leaveRequests, employeeFilter]);

  return (
    <Card className="border-[rgb(230,230,230)] shadow-sm overflow-hidden">
      <CardHeader className="pb-4 pt-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <CardTitle className="text-base font-semibold text-[rgb(64,64,64)]">
              Leave history
            </CardTitle>
            <p className="text-sm text-[rgb(133,133,133)] mt-1">
              All leave requests across the organization.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={employeeFilter} onValueChange={setEmployeeFilter}>
              <SelectTrigger className="w-full sm:w-[200px] h-8 text-xs border-[rgb(230,230,230)]">
                <SelectValue placeholder="Employee" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All employees</SelectItem>
                {employees?.map((emp) => (
                  <SelectItem key={emp._id} value={emp._id}>
                    {emp.personalInfo?.firstName} {emp.personalInfo?.lastName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsManualDialogOpen(true)}
              className="shrink-0 border-[rgb(230,230,230)]"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add history
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onManageColumns}
              className="shrink-0 border-[rgb(230,230,230)]"
            >
              <Settings className="h-4 w-4 mr-2" />
              Manage columns
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0 pb-0">
        <DynamicLeaveTable
          leaveRequests={filteredRequests}
          columns={columns}
          employees={employees}
          pageSize={20}
          configuredLeaveTypes={configuredLeaveTypes}
          cutoffDates={cutoffDates}
        />
      </CardContent>
      <ManualLeaveEntryDialog
        isOpen={isManualDialogOpen}
        onOpenChange={setIsManualDialogOpen}
        organizationId={organizationId}
        employees={employees ?? []}
        leaveTrackerMode={leaveTrackerMode}
        configuredLeaveTypes={configuredLeaveTypes}
      />
    </Card>
  );
}
