"use client";

import { Dispatch, SetStateAction, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Search, Plus, ChevronDown, X } from "lucide-react";
import { cn } from "@/utils/utils";

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
}

// Status color mappings
const STATUS_COLORS: Record<string, string> = {
  active: "#22C55E", // green
  inactive: "#9CA3AF", // gray
  resigned: "#F97316", // orange
  terminated: "#EF4444", // red/coral
};

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  inactive: "Inactive (Archived)",
  resigned: "Resigned",
  terminated: "Terminated",
};

export function EmployeesFilters({
  search,
  setSearch,
  departmentFilter,
  setDepartmentFilter,
  statusFilter,
  setStatusFilter,
  settingsForDepartments,
}: EmployeesFiltersProps) {
  const [departmentPopoverOpen, setDepartmentPopoverOpen] = useState(false);
  const [statusPopoverOpen, setStatusPopoverOpen] = useState(false);

  // Get departments with colors
  const departments = useMemo(() => {
    const depts = settingsForDepartments?.departments || [];
    return depts.length > 0 && typeof depts[0] === "string"
      ? (depts as string[]).map((name) => ({ name, color: "#3B82F6" }))
      : (depts as { name: string; color: string }[]);
  }, [settingsForDepartments]);

  const selectedDepartment = useMemo(() => {
    if (departmentFilter === "all") return null;
    return departments.find((d) => d.name === departmentFilter);
  }, [departmentFilter, departments]);

  const isDepartmentActive =
    departmentFilter !== "all" && departmentFilter !== "";
  const isStatusActive = statusFilter !== "active";

  const hasActiveFilters =
    (search?.trim() ?? "") !== "" ||
    (departmentFilter !== "all" && departmentFilter !== "") ||
    statusFilter !== "active";

  const handleClearFilters = (e: React.MouseEvent) => {
    e.preventDefault();
    setSearch("");
    setDepartmentFilter("all");
    setStatusFilter("active");
  };

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 flex-wrap">
      <div className="relative w-full sm:w-[200px] sm:max-w-[240px]">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[rgb(64,64,64)] pointer-events-none" />
        <Input
          placeholder="Search employees..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 pl-8 rounded-lg border border-[#DDDDDD] hover:border-[rgb(120,120,120)] bg-[rgb(250,250,250)] text-xs font-semibold text-[rgb(64,64,64)] placeholder:text-[rgb(133,133,133)] shadow-sm focus-visible:outline-none"
        />
      </div>

      {/* Department filter chip */}
      <Popover
        open={departmentPopoverOpen}
        onOpenChange={setDepartmentPopoverOpen}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              "inline-flex items-center gap-1.5 h-8 px-2.5 rounded-2xl text-xs font-semibold text-[rgb(64,64,64)] bg-white transition-colors hover:bg-[rgb(250,250,250)]",
              isDepartmentActive
                ? "border border-[#DDDDDD] border-solid"
                : "border border-dashed border-[#DDDDDD]"
            )}
          >
            {isDepartmentActive ? (
              <>
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    setDepartmentFilter("all");
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.stopPropagation();
                      setDepartmentFilter("all");
                    }
                  }}
                  className="flex items-center justify-center w-4 h-4 rounded-full hover:bg-[rgb(230,230,230)] text-[rgb(100,100,100)] cursor-pointer"
                  aria-label="Clear department"
                >
                  <X className="h-2.5 w-2.5" />
                </span>
                <span className="text-[rgb(133,133,133)] font-semibold">
                  Department
                </span>
                <span className="font-semibold">
                  {selectedDepartment?.name ?? "All"}
                </span>
                <div
                  className="h-2.5 w-2.5 rounded-full shrink-0"
                  style={{
                    backgroundColor: selectedDepartment?.color ?? "#9CA3AF",
                  }}
                />
                <ChevronDown className="h-3 w-3 shrink-0 text-[rgb(133,133,133)]" />
              </>
            ) : (
              <>
                <span className="flex items-center justify-center w-4 h-4 rounded-full border border-[rgb(180,180,180)] text-[rgb(120,120,120)]">
                  <Plus className="h-2.5 w-2.5" />
                </span>
                <span className="font-semibold">Department</span>
                <ChevronDown className="h-3 w-3 shrink-0 text-[rgb(133,133,133)]" />
              </>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-3" align="start">
          <h4 className="font-semibold text-xs text-[rgb(64,64,64)] mb-3">
            Filter by: Department
          </h4>
          <div className="space-y-0.5 max-h-[280px] overflow-y-auto">
            <button
              type="button"
              onClick={() => {
                setDepartmentFilter("all");
                setDepartmentPopoverOpen(false);
              }}
              className={cn(
                "w-full flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold",
                departmentFilter === "all"
                  ? "bg-[rgb(245,245,245)]"
                  : "hover:bg-[rgb(250,250,250)]"
              )}
            >
              <div className="h-2.5 w-2.5 rounded-full shrink-0 bg-[#9CA3AF]" />
              <span>All</span>
            </button>
            {departments.map((dept) => (
              <button
                key={dept.name}
                type="button"
                onClick={() => {
                  setDepartmentFilter(dept.name);
                  setDepartmentPopoverOpen(false);
                }}
                className={cn(
                  "w-full flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold",
                  departmentFilter === dept.name
                    ? "bg-[rgb(245,245,245)]"
                    : "hover:bg-[rgb(250,250,250)]"
                )}
              >
                <div
                  className="h-2.5 w-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: dept.color }}
                />
                <span>{dept.name}</span>
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {/* Status filter chip */}
      <Popover open={statusPopoverOpen} onOpenChange={setStatusPopoverOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              "inline-flex items-center gap-1.5 h-8 px-2.5 rounded-2xl text-xs font-semibold text-[rgb(64,64,64)] bg-white transition-colors hover:bg-[rgb(250,250,250)]",
              isStatusActive
                ? "border border-[#DDDDDD] border-solid"
                : "border border-dashed border-[#DDDDDD]"
            )}
          >
            {isStatusActive ? (
              <>
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    setStatusFilter("active");
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.stopPropagation();
                      setStatusFilter("active");
                    }
                  }}
                  className="flex items-center justify-center w-4 h-4 rounded-full hover:bg-[rgb(230,230,230)] text-[rgb(100,100,100)] cursor-pointer"
                  aria-label="Clear status"
                >
                  <X className="h-2.5 w-2.5" />
                </span>
                <span className="text-[rgb(133,133,133)] font-semibold">
                  Status
                </span>
                <span className="font-semibold">
                  {STATUS_LABELS[statusFilter]}
                </span>
                <div
                  className="h-2.5 w-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: STATUS_COLORS[statusFilter] }}
                />
                <ChevronDown className="h-3 w-3 shrink-0 text-[rgb(133,133,133)]" />
              </>
            ) : (
              <>
                <span className="flex items-center justify-center w-4 h-4 rounded-full border border-[rgb(180,180,180)] text-[rgb(120,120,120)]">
                  <Plus className="h-2.5 w-2.5" />
                </span>
                <span className="font-semibold">Status</span>
                <ChevronDown className="h-3 w-3 shrink-0 text-[rgb(133,133,133)]" />
              </>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-3" align="start">
          <h4 className="font-semibold text-xs text-[rgb(64,64,64)] mb-3">
            Filter by: Status
          </h4>
          <div className="space-y-0.5">
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setStatusFilter(
                    value as "active" | "inactive" | "resigned" | "terminated"
                  );
                  setStatusPopoverOpen(false);
                }}
                className={cn(
                  "w-full flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold",
                  statusFilter === value
                    ? "bg-[rgb(245,245,245)]"
                    : "hover:bg-[rgb(250,250,250)]"
                )}
              >
                <div
                  className="h-2.5 w-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: STATUS_COLORS[value] }}
                />
                <span>{label}</span>
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {hasActiveFilters ? (
        <button
          type="button"
          onClick={handleClearFilters}
          className="text-xs font-semibold text-[#695eff] hover:text-[#5547e8] shrink-0"
        >
          Clear filters
        </button>
      ) : null}
    </div>
  );
}
