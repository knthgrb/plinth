"use client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

interface PayrollStep2EmployeesProps {
  employees: any[];
  selectedEmployees: string[];
  onEmployeeSelect: (employeeId: string, checked: boolean) => void;
  onSelectAll: () => void;
  /** When true, employees are still loading (e.g. from Convex query) */
  isLoading?: boolean;
}

export function PayrollStep2Employees({
  employees,
  selectedEmployees,
  onEmployeeSelect,
  onSelectAll,
  isLoading = false,
}: PayrollStep2EmployeesProps) {
  const list = Array.isArray(employees) ? employees : [];
  return (
    <div className="grid gap-4 py-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Select Employees <span className="text-red-500">*</span></Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onSelectAll}
            disabled={isLoading || list.length === 0}
          >
            {selectedEmployees.length === list.length
              ? "Deselect All"
              : "Select All"}
          </Button>
        </div>
        <div className="max-h-64 overflow-y-auto border rounded-md p-2">
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              Loading employees…
            </p>
          ) : list.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No employees in this organization.
            </p>
          ) : (
            list.map((emp: any) => (
              <label
                key={emp._id}
                className="flex items-center gap-2 p-2 hover:bg-gray-50 rounded"
              >
                <input
                  className="h-4 w-4 accent-brand-purple"
                  type="checkbox"
                  checked={selectedEmployees.includes(emp._id)}
                  onChange={(e) => onEmployeeSelect(emp._id, e.target.checked)}
                />
                <span>
                  {emp.personalInfo.firstName} {emp.personalInfo.lastName} -{" "}
                  {emp.employment.employeeId}
                </span>
              </label>
            ))
          )}
        </div>
        {selectedEmployees.length > 0 && (
          <p className="text-sm text-gray-500">
            {selectedEmployees.length} employee(s) selected
          </p>
        )}
      </div>
    </div>
  );
}
