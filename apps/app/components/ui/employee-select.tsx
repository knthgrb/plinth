"use client";

import { useState, useMemo } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, ChevronDown } from "lucide-react";
import { cn } from "@/utils/utils";

interface Employee {
  _id: string;
  personalInfo: {
    firstName: string;
    lastName: string;
    middleName?: string;
  };
  employment: {
    employeeId: string;
    position?: string;
    department?: string;
  };
}

interface EmployeeSelectProps {
  employees: Employee[] | undefined;
  value?: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function EmployeeSelect({
  employees,
  value,
  onValueChange,
  disabled = false,
  placeholder = "Select employee...",
}: EmployeeSelectProps) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const selectedEmployee = useMemo(() => {
    return employees?.find((emp) => emp._id === value);
  }, [employees, value]);

  const filteredEmployees = useMemo(() => {
    if (!employees) return [];
    if (!searchQuery.trim()) return employees;
    const query = searchQuery.toLowerCase();
    return employees.filter((emp) => {
      const fullName =
        `${emp.personalInfo.firstName} ${emp.personalInfo.lastName}`.toLowerCase();
      const employeeId = emp.employment.employeeId?.toLowerCase() || "";
      const position = emp.employment.position?.toLowerCase() || "";
      return (
        fullName.includes(query) ||
        employeeId.includes(query) ||
        position.includes(query)
      );
    });
  }, [employees, searchQuery]);

  const handleSelect = (employeeId: string) => {
    onValueChange(employeeId);
    setOpen(false);
    setSearchQuery("");
  };

  const displayName = selectedEmployee
    ? `${selectedEmployee.personalInfo.firstName} ${selectedEmployee.personalInfo.lastName}${selectedEmployee.employment.position ? ` - ${selectedEmployee.employment.position}` : ""}`
    : placeholder;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between h-9"
          disabled={disabled}
        >
          <span
            className={cn("truncate", !selectedEmployee && "text-gray-500")}
          >
            {displayName}
          </span>
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0" align="start" sideOffset={4}>
        <div className="p-2">
          <div className="relative mb-2">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search employees..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8"
            />
          </div>
          <div className="max-h-[200px] overflow-y-auto">
            {filteredEmployees.length === 0 ? (
              <div className="p-4 text-center text-sm text-gray-500">
                No employees found
              </div>
            ) : (
              <div className="space-y-1">
                {filteredEmployees.map((emp) => (
                  <button
                    key={emp._id}
                    type="button"
                    onClick={() => handleSelect(emp._id)}
                    className={cn(
                      "w-full flex flex-col items-start gap-1 px-3 py-2 text-sm rounded-md hover:bg-gray-100 transition-colors text-left",
                      value === emp._id && "bg-gray-100",
                    )}
                  >
                    <span className="font-medium">
                      {emp.personalInfo.firstName} {emp.personalInfo.lastName}
                    </span>
                    {emp.employment.position && (
                      <span className="text-xs text-gray-500">
                        {emp.employment.position}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
