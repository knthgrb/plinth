"use client";

import { Dispatch, SetStateAction } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search } from "lucide-react";

interface EmployeesFiltersProps {
  search: string;
  setSearch: Dispatch<SetStateAction<string>>;
  departmentFilter: string;
  setDepartmentFilter: Dispatch<SetStateAction<string>>;
  statusFilter: "active" | "inactive" | "resigned" | "terminated";
  setStatusFilter: Dispatch<
    SetStateAction<"active" | "inactive" | "resigned" | "terminated">
  >;
  settingsForDepartments: any;
  setDepartmentDropdownOpen: Dispatch<SetStateAction<boolean>>;
}

export function EmployeesFilters({
  search,
  setSearch,
  departmentFilter,
  setDepartmentFilter,
  statusFilter,
  setStatusFilter,
  settingsForDepartments,
  setDepartmentDropdownOpen,
}: EmployeesFiltersProps) {
  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="relative flex-1 min-w-[220px]">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <Input
          placeholder="Search employees..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10"
        />
      </div>
      <Select
        value={departmentFilter}
        onValueChange={(value: any) => setDepartmentFilter(value)}
        onOpenChange={(open) => setDepartmentDropdownOpen(open)}
      >
        <SelectTrigger className="w-[200px]">
          <SelectValue placeholder="Filter by department" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Departments</SelectItem>
          {(settingsForDepartments?.departments || []).map((dept: string) => (
            <SelectItem key={dept} value={dept}>
              {dept}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={statusFilter}
        onValueChange={(value: any) => setStatusFilter(value)}
      >
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder="Filter by status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="active">Active</SelectItem>
          <SelectItem value="inactive">Inactive (Archived)</SelectItem>
          <SelectItem value="resigned">Resigned</SelectItem>
          <SelectItem value="terminated">Terminated</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
