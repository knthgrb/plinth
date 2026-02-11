"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Settings } from "lucide-react";
import { cn } from "@/utils/utils";
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

type LeaveStatusFilter =
  | "all"
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled";

interface AdminLeaveRequestsTabProps {
  leaveRequests: any[];
  columns: Column[];
  employees?: any[];
  onManageColumns: () => void;
  onReviewRequest: (request: any) => void;
}

export function AdminLeaveRequestsTab({
  leaveRequests,
  columns,
  employees,
  onManageColumns,
  onReviewRequest,
}: AdminLeaveRequestsTabProps) {
  const [statusFilter, setStatusFilter] = useState<LeaveStatusFilter>("all");

  const counts = useMemo(() => {
    const list = leaveRequests || [];
    return {
      all: list.length,
      approved: list.filter(
        (r: any) => String(r.status || "").toLowerCase() === "approved"
      ).length,
      pending: list.filter(
        (r: any) => String(r.status || "").toLowerCase() === "pending"
      ).length,
      rejected: list.filter(
        (r: any) => String(r.status || "").toLowerCase() === "rejected"
      ).length,
    };
  }, [leaveRequests]);

  const filteredRequests = useMemo(() => {
    if (statusFilter === "all") return leaveRequests;
    return leaveRequests.filter(
      (r: any) => String(r.status || "").toLowerCase() === statusFilter
    );
  }, [leaveRequests, statusFilter]);

  const summaryCards: {
    id: LeaveStatusFilter;
    label: string;
    count: number;
  }[] = [
    { id: "all", label: "All", count: counts.all },
    { id: "approved", label: "Approved", count: counts.approved },
    { id: "pending", label: "Pending", count: counts.pending },
    { id: "rejected", label: "Rejected", count: counts.rejected },
  ];

  return (
    <div className="space-y-5">
      {/* Summary cards – outside table container */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {summaryCards.map((card) => {
          const isActive = statusFilter === card.id;
          return (
            <button
              key={card.id}
              type="button"
              onClick={() => setStatusFilter(card.id)}
              className={cn(
                "flex flex-col items-start rounded-lg border px-5 py-4 min-w-0 text-left transition-colors",
                isActive
                  ? "border-brand-purple bg-brand-purple/5"
                  : "border-[rgb(230,230,230)] bg-[rgb(250,250,250)] hover:bg-[rgb(245,245,245)]"
              )}
            >
              <span
                className={cn(
                  "text-xs font-semibold",
                  isActive ? "text-brand-purple" : "text-[rgb(133,133,133)]"
                )}
              >
                {card.label}
              </span>
              <span
                className={cn(
                  "text-xl font-bold mt-0.5",
                  isActive ? "text-brand-purple" : "text-[rgb(64,64,64)]"
                )}
              >
                {card.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Table container */}
      <Card className="border-[rgb(230,230,230)] shadow-sm overflow-hidden">
        <CardHeader className="pb-4 pt-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <CardTitle className="text-base font-semibold text-[rgb(64,64,64)]">
                Leave requests
              </CardTitle>
              <p className="text-sm text-[rgb(133,133,133)] mt-1">
                Review and approve or reject pending leave requests.
              </p>
            </div>
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
        </CardHeader>
        <CardContent className="pt-0 pb-0">
          <DynamicLeaveTable
            leaveRequests={filteredRequests}
            columns={columns}
            employees={employees}
            onRowClick={onReviewRequest}
            pageSize={20}
          />
        </CardContent>
      </Card>
    </div>
  );
}
