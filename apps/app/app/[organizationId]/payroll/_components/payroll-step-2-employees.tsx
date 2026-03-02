"use client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

interface PayrollStep2EmployeesProps {
  employees: any[];
  selectedEmployees: string[];
  onEmployeeSelect: (employeeId: string, checked: boolean) => void;
  onSelectAll: () => void;
}

export function PayrollStep2Employees({
  employees,
  selectedEmployees,
  onEmployeeSelect,
  onSelectAll,
}: PayrollStep2EmployeesProps) {
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
          >
            {selectedEmployees.length === employees?.length
              ? "Deselect All"
              : "Select All"}
          </Button>
        </div>
        <div className="max-h-64 overflow-y-auto border rounded-md p-2">
          {employees?.map((emp: any) => (
            <label
              key={emp._id}
              className="flex items-center gap-2 p-2 hover:bg-gray-50 rounded"
            >
              <input
                className="h-4 w-4 accent-purple-600"
                type="checkbox"
                checked={selectedEmployees.includes(emp._id)}
                onChange={(e) => onEmployeeSelect(emp._id, e.target.checked)}
              />
              <span>
                {emp.personalInfo.firstName} {emp.personalInfo.lastName} -{" "}
                {emp.employment.employeeId}
              </span>
            </label>
          ))}
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
