"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Edit, User } from "lucide-react";
import { getEmployeeLeaveCredits } from "@/actions/leave";

interface LeaveTypeConfig {
  type: string;
  name: string;
}

interface LeaveCreditsEmployeeViewProps {
  employees: any[];
  organizationId: string;
  leaveTypes?: LeaveTypeConfig[];
  onEdit: (employeeId: string) => void;
  refreshKey?: number;
}

export function LeaveCreditsEmployeeView({
  employees,
  organizationId,
  leaveTypes = [],
  onEdit,
  refreshKey = 0,
}: LeaveCreditsEmployeeViewProps) {
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>("");
  const [credits, setCredits] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const selectedEmployee = employees.find((e: any) => e._id === selectedEmployeeId);
  const displayName = selectedEmployee
    ? `${selectedEmployee.personalInfo?.firstName ?? ""} ${selectedEmployee.personalInfo?.lastName ?? ""}`.trim() || "—"
    : "";

  useEffect(() => {
    if (!organizationId || !selectedEmployeeId) {
      setCredits(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    getEmployeeLeaveCredits(organizationId, selectedEmployeeId)
      .then((data) => {
        if (!cancelled) setCredits(data);
      })
      .catch(() => {
        if (!cancelled) setCredits(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [organizationId, selectedEmployeeId, refreshKey]);

  const getLeaveTypeName = (type: string) => {
    const lt = leaveTypes.find((t) => t.type === type);
    return lt?.name ?? type;
  };

  if (!employees?.length) {
    return (
      <div className="rounded-lg border border-[rgb(230,230,230)] bg-[rgb(250,250,250)] py-12 text-center text-sm text-[rgb(133,133,133)]">
        No employees to display.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex-1 space-y-2">
          <label className="text-sm font-medium text-[rgb(64,64,64)]">
            Select employee
          </label>
          <Select
            value={selectedEmployeeId || undefined}
            onValueChange={(value) => setSelectedEmployeeId(value || "")}
          >
            <SelectTrigger className="w-full sm:max-w-[320px] border-[rgb(230,230,230)]">
              <SelectValue placeholder="Choose an employee…" />
            </SelectTrigger>
            <SelectContent>
              {employees.map((emp: any) => {
                const name =
                  `${emp.personalInfo?.firstName ?? ""} ${emp.personalInfo?.lastName ?? ""}`.trim() ||
                  "—";
                return (
                  <SelectItem key={emp._id} value={emp._id}>
                    {name}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
        {selectedEmployeeId && (
          <Button
            variant="outline"
            size="sm"
            className="border-[rgb(230,230,230)] shrink-0"
            onClick={() => onEdit(selectedEmployeeId)}
          >
            <Edit className="h-3.5 w-3.5 mr-1.5" />
            Edit credits
          </Button>
        )}
      </div>

      {!selectedEmployeeId && (
        <div className="rounded-lg border border-[rgb(230,230,230)] bg-[rgb(250,250,250)] py-16 text-center">
          <User className="mx-auto h-10 w-10 text-[rgb(200,200,200)] mb-3" />
          <p className="text-sm text-[rgb(133,133,133)]">
            Select an employee above to view their leave credits.
          </p>
        </div>
      )}

      {selectedEmployeeId && loading && (
        <div className="rounded-lg border border-[rgb(230,230,230)] bg-[rgb(250,250,250)] py-12 text-center text-sm text-[rgb(133,133,133)]">
          Loading leave credits…
        </div>
      )}

      {selectedEmployeeId && !loading && credits && (
        <Card className="border-[rgb(230,230,230)] shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold text-[rgb(64,64,64)]">
              Leave credits — {displayName}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {credits.vacation != null && (
                <div className="rounded-lg border border-[rgb(230,230,230)] bg-[rgb(250,250,250)] p-4">
                  <p className="text-xs font-medium text-[rgb(133,133,133)] uppercase tracking-wider">
                    {getLeaveTypeName("vacation")}
                  </p>
                  <p className="mt-1 text-lg font-semibold text-[rgb(64,64,64)]">
                    {credits.vacation.balance ?? 0} / {credits.vacation.total ?? 0} days
                  </p>
                  <p className="text-xs text-[rgb(133,133,133)] mt-0.5">
                    Used: {credits.vacation.used ?? 0} days
                  </p>
                </div>
              )}
              {credits.sick != null && (
                <div className="rounded-lg border border-[rgb(230,230,230)] bg-[rgb(250,250,250)] p-4">
                  <p className="text-xs font-medium text-[rgb(133,133,133)] uppercase tracking-wider">
                    {getLeaveTypeName("sick")}
                  </p>
                  <p className="mt-1 text-lg font-semibold text-[rgb(64,64,64)]">
                    {credits.sick.balance ?? 0} / {credits.sick.total ?? 0} days
                  </p>
                  <p className="text-xs text-[rgb(133,133,133)] mt-0.5">
                    Used: {credits.sick.used ?? 0} days
                  </p>
                </div>
              )}
              {(credits.custom ?? []).map((c: any) => (
                <div
                  key={c.type}
                  className="rounded-lg border border-[rgb(230,230,230)] bg-[rgb(250,250,250)] p-4"
                >
                  <p className="text-xs font-medium text-[rgb(133,133,133)] uppercase tracking-wider">
                    {getLeaveTypeName(c.type)}
                  </p>
                  <p className="mt-1 text-lg font-semibold text-[rgb(64,64,64)]">
                    {c.balance ?? 0} / {c.total ?? 0} days
                  </p>
                  <p className="text-xs text-[rgb(133,133,133)] mt-0.5">
                    Used: {c.used ?? 0} days
                  </p>
                </div>
              ))}
            </div>
            {credits.calculations && (
              <div className="mt-4 pt-4 border-t border-[rgb(230,230,230)] grid gap-2 text-sm text-[rgb(133,133,133)]">
                <div className="flex justify-between">
                  <span>Prorated leave</span>
                  <span className="font-medium text-[rgb(64,64,64)]">
                    {credits.calculations.proratedLeave?.toFixed(2) ?? 0} days
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Anniversary leave</span>
                  <span className="font-medium text-[rgb(64,64,64)]">
                    {credits.calculations.anniversaryLeave ?? 0} days
                  </span>
                </div>
                <div className="flex justify-between border-t border-[rgb(230,230,230)] pt-2 font-medium text-[rgb(64,64,64)]">
                  <span>Total entitlement</span>
                  <span>
                    {credits.calculations.totalEntitlement?.toFixed(2) ?? 0} days
                  </span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {selectedEmployeeId && !loading && !credits && (
        <div className="rounded-lg border border-[rgb(230,230,230)] bg-[rgb(250,250,250)] py-12 text-center text-sm text-[rgb(133,133,133)]">
          Could not load leave credits.
        </div>
      )}
    </div>
  );
}
