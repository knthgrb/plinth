"use client";

import { Dispatch, SetStateAction, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Plus, ChevronDown, ChevronLeft, X, Search } from "lucide-react";
import { cn } from "@/utils/utils";

type CreatedDateFilter = {
  mode: "inLast";
  value: number;
  unit: "days" | "weeks" | "months";
};

interface EmployeesFiltersProps {
  departmentFilter: string;
  setDepartmentFilter: Dispatch<SetStateAction<string>>;
  statusFilter: "active" | "inactive" | "resigned" | "terminated";
  setStatusFilter: Dispatch<
    SetStateAction<"active" | "inactive" | "resigned" | "terminated">
  >;
  settingsForDepartments: any;
  nameFilter: string;
  setNameFilter: Dispatch<SetStateAction<string>>;
  positionFilter: string;
  setPositionFilter: Dispatch<SetStateAction<string>>;
  phoneFilter: string;
  setPhoneFilter: Dispatch<SetStateAction<string>>;
  createdDateFilter: CreatedDateFilter | null;
  setCreatedDateFilter: Dispatch<SetStateAction<CreatedDateFilter | null>>;
  /** When true, search is on its own row (full width) and filter chips on a row below */
  stackedLayout?: boolean;
  /** Optional node (e.g. Edit columns button) rendered on the same row as filter chips when stackedLayout */
  extraAction?: React.ReactNode;
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
  departmentFilter,
  setDepartmentFilter,
  statusFilter,
  setStatusFilter,
  settingsForDepartments,
  nameFilter,
  setNameFilter,
  positionFilter,
  setPositionFilter,
  phoneFilter,
  setPhoneFilter,
  createdDateFilter,
  setCreatedDateFilter,
  stackedLayout = false,
  extraAction,
}: EmployeesFiltersProps) {
  const [departmentPopoverOpen, setDepartmentPopoverOpen] = useState(false);
  const [statusPopoverOpen, setStatusPopoverOpen] = useState(false);
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false);
  const [moreFilterSelected, setMoreFilterSelected] = useState<
    null | "position" | "phone" | "createdDate"
  >(null);

  const [draftPosition, setDraftPosition] = useState(positionFilter);
  const [draftPhone, setDraftPhone] = useState(phoneFilter);
  const [draftCreatedValue, setDraftCreatedValue] = useState(
    createdDateFilter?.value?.toString() ?? "",
  );
  const [draftCreatedUnit, setDraftCreatedUnit] = useState<
    "days" | "weeks" | "months"
  >(createdDateFilter?.unit ?? "days");

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

  const createdDateSummary = useMemo(() => {
    if (!createdDateFilter) return "";

    const unit =
      createdDateFilter.unit === "days"
        ? createdDateFilter.value === 1
          ? "day"
          : "days"
        : createdDateFilter.unit === "weeks"
          ? createdDateFilter.value === 1
            ? "week"
            : "weeks"
          : createdDateFilter.value === 1
            ? "month"
            : "months";

    return `Last ${createdDateFilter.value} ${unit}`;
  }, [createdDateFilter]);

  const isDepartmentActive =
    departmentFilter !== "all" && departmentFilter !== "";
  const isStatusActive = statusFilter !== "active";
  const isNameActive = (nameFilter?.trim() ?? "") !== "";
  const isMoreFiltersActive =
    (positionFilter?.trim() ?? "") !== "" ||
    (phoneFilter?.trim() ?? "") !== "" ||
    !!createdDateFilter;

  const hasActiveFilters =
    isDepartmentActive || isStatusActive || isNameActive || isMoreFiltersActive;

  const handleClearFilters = (e: React.MouseEvent) => {
    e.preventDefault();
    setDepartmentFilter("all");
    setStatusFilter("active");
    setNameFilter("");
    setPositionFilter("");
    setPhoneFilter("");
    setCreatedDateFilter(null);
  };

  const searchInput = (
    <div
      className={cn(
        "relative",
        stackedLayout ? "w-full max-w-[260px]" : "min-w-[140px] w-40",
      )}
    >
      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-[rgb(133,133,133)] pointer-events-none" />
      <Input
        placeholder="Search"
        value={nameFilter}
        onChange={(e) => setNameFilter(e.target.value)}
        className="h-8 pl-7 pr-2 rounded-lg text-[11px] font-semibold text-[rgb(64,64,64)] bg-white border border-solid border-[#DDDDDD] shadow-sm focus-visible:ring-[#695eff] focus-visible:ring-offset-0"
      />
    </div>
  );

  const filterChips = (
    <>
      {/* Department filter chip */}
      <Popover
        open={departmentPopoverOpen}
        onOpenChange={setDepartmentPopoverOpen}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              "inline-flex items-center gap-1 h-7 px-2 rounded-xl text-[11px] font-semibold text-[rgb(64,64,64)] bg-white transition-colors hover:bg-[rgb(250,250,250)]",
              isDepartmentActive
                ? "border border-[#DDDDDD] border-solid"
                : "border border-dashed border-[#DDDDDD]",
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
                  className="flex items-center justify-center w-3.5 h-3.5 rounded-full hover:bg-[rgb(230,230,230)] text-[rgb(100,100,100)] cursor-pointer"
                  aria-label="Clear department"
                >
                  <X className="h-2 w-2" />
                </span>
                <span className="text-[rgb(133,133,133)] font-semibold">
                  Department
                </span>
                <span className="font-semibold">
                  {selectedDepartment?.name ?? "All"}
                </span>
                <div
                  className="h-2 w-2 rounded-full shrink-0"
                  style={{
                    backgroundColor: selectedDepartment?.color ?? "#9CA3AF",
                  }}
                />
                <ChevronDown className="h-2.5 w-2.5 shrink-0 text-[rgb(133,133,133)]" />
              </>
            ) : (
              <>
                <span className="flex items-center justify-center w-3.5 h-3.5 rounded-full border border-[rgb(180,180,180)] text-[rgb(120,120,120)]">
                  <Plus className="h-2 w-2" />
                </span>
                <span className="font-semibold">Department</span>
                <ChevronDown className="h-2.5 w-2.5 shrink-0 text-[rgb(133,133,133)]" />
              </>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-2.5" align="start">
          <h4 className="font-semibold text-[11px] text-[rgb(64,64,64)] mb-2">
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
                  : "hover:bg-[rgb(250,250,250)]",
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
                    : "hover:bg-[rgb(250,250,250)]",
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
              "inline-flex items-center gap-1 h-7 px-2 rounded-xl text-[11px] font-semibold text-[rgb(64,64,64)] bg-white transition-colors hover:bg-[rgb(250,250,250)]",
              isStatusActive
                ? "border border-[#DDDDDD] border-solid"
                : "border border-dashed border-[#DDDDDD]",
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
                  className="flex items-center justify-center w-3.5 h-3.5 rounded-full hover:bg-[rgb(230,230,230)] text-[rgb(100,100,100)] cursor-pointer"
                  aria-label="Clear status"
                >
                  <X className="h-2 w-2" />
                </span>
                <span className="text-[rgb(133,133,133)] font-semibold">
                  Status
                </span>
                <span className="font-semibold">
                  {STATUS_LABELS[statusFilter]}
                </span>
                <div
                  className="h-2 w-2 rounded-full shrink-0"
                  style={{ backgroundColor: STATUS_COLORS[statusFilter] }}
                />
                <ChevronDown className="h-2.5 w-2.5 shrink-0 text-[rgb(133,133,133)]" />
              </>
            ) : (
              <>
                <span className="flex items-center justify-center w-3.5 h-3.5 rounded-full border border-[rgb(180,180,180)] text-[rgb(120,120,120)]">
                  <Plus className="h-2 w-2" />
                </span>
                <span className="font-semibold">Status</span>
                <ChevronDown className="h-2.5 w-2.5 shrink-0 text-[rgb(133,133,133)]" />
              </>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-2.5" align="start">
          <h4 className="font-semibold text-[11px] text-[rgb(64,64,64)] mb-2">
            Filter by: Status
          </h4>
          <div className="space-y-0.5">
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setStatusFilter(
                    value as "active" | "inactive" | "resigned" | "terminated",
                  );
                  setStatusPopoverOpen(false);
                }}
                className={cn(
                  "w-full flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold",
                  statusFilter === value
                    ? "bg-[rgb(245,245,245)]"
                    : "hover:bg-[rgb(250,250,250)]",
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

      {/* More filters chip */}
      <Popover
        open={moreFiltersOpen}
        onOpenChange={(open) => {
          setMoreFiltersOpen(open);
          if (!open) setMoreFilterSelected(null);
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              "inline-flex items-center gap-1 h-7 px-2 rounded-xl text-[11px] font-semibold text-[rgb(64,64,64)] bg-white transition-colors hover:bg-[rgb(250,250,250)]",
              isMoreFiltersActive
                ? "border border-[#DDDDDD] border-solid"
                : "border border-dashed border-[#DDDDDD]",
            )}
            onClick={() => {
              setMoreFilterSelected(null);
              setDraftPosition(positionFilter);
              setDraftPhone(phoneFilter);
              setDraftCreatedValue(createdDateFilter?.value?.toString() ?? "");
              setDraftCreatedUnit(createdDateFilter?.unit ?? "days");
            }}
          >
            <span className="flex items-center justify-center w-3.5 h-3.5 rounded-full border border-[rgb(180,180,180)] text-[rgb(120,120,120)]">
              <Plus className="h-2 w-2" />
            </span>
            <span className="font-semibold">More filters</span>
            <ChevronDown className="h-2.5 w-2.5 shrink-0 text-[rgb(133,133,133)]" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="start">
          {moreFilterSelected === null ? (
            <>
              <div className="p-2.5 border-b border-gray-100">
                <h4 className="font-semibold text-[11px] text-[rgb(64,64,64)]">
                  More filters
                </h4>
              </div>
              <div className="p-1">
                <button
                  type="button"
                  onClick={() => setMoreFilterSelected("position")}
                  className="w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[11px] font-semibold text-[#695eff] hover:bg-[rgb(250,250,250)]"
                >
                  <Plus className="h-3 w-3 shrink-0" />
                  Position
                </button>
                <button
                  type="button"
                  onClick={() => setMoreFilterSelected("phone")}
                  className="w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[11px] font-semibold text-[#695eff] hover:bg-[rgb(250,250,250)]"
                >
                  <Plus className="h-3 w-3 shrink-0" />
                  Phone number
                </button>
                <button
                  type="button"
                  onClick={() => setMoreFilterSelected("createdDate")}
                  className="w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[11px] font-semibold text-[#695eff] hover:bg-[rgb(250,250,250)]"
                >
                  <Plus className="h-3 w-3 shrink-0" />
                  Created date
                </button>
              </div>
            </>
          ) : moreFilterSelected === "position" ? (
            <div className="p-2.5">
              <div className="flex items-center gap-2 mb-3">
                <button
                  type="button"
                  onClick={() => setMoreFilterSelected(null)}
                  className="flex items-center justify-center w-7 h-7 rounded-md hover:bg-[rgb(245,245,245)] text-[rgb(100,100,100)]"
                  aria-label="Back"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <h4 className="font-semibold text-[11px] text-[rgb(64,64,64)]">
                  Filter by: Position
                </h4>
              </div>
              <div className="space-y-2">
                <p className="text-[11px] font-medium text-[rgb(100,100,100)]">
                  contains
                </p>
                <Input
                  placeholder="Type position"
                  value={draftPosition}
                  onChange={(e) => setDraftPosition(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
              <div className="flex justify-end mt-3">
                <Button
                  size="sm"
                  className="h-7 px-2.5 text-[11px] bg-[#695eff] hover:bg-[#5547e8]"
                  onClick={() => {
                    setPositionFilter(draftPosition.trim());
                    setMoreFiltersOpen(false);
                    setMoreFilterSelected(null);
                  }}
                >
                  Apply
                </Button>
              </div>
            </div>
          ) : moreFilterSelected === "phone" ? (
            <div className="p-2.5">
              <div className="flex items-center gap-2 mb-3">
                <button
                  type="button"
                  onClick={() => setMoreFilterSelected(null)}
                  className="flex items-center justify-center w-7 h-7 rounded-md hover:bg-[rgb(245,245,245)] text-[rgb(100,100,100)]"
                  aria-label="Back"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <h4 className="font-semibold text-[11px] text-[rgb(64,64,64)]">
                  Filter by: Phone number
                </h4>
              </div>
              <div className="space-y-2">
                <p className="text-[11px] font-medium text-[rgb(100,100,100)]">
                  contains
                </p>
                <Input
                  placeholder="Type phone number"
                  value={draftPhone}
                  onChange={(e) => setDraftPhone(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
              <div className="flex justify-end mt-3">
                <Button
                  size="sm"
                  className="h-7 px-2.5 text-[11px] bg-[#695eff] hover:bg-[#5547e8]"
                  onClick={() => {
                    setPhoneFilter(draftPhone.trim());
                    setMoreFiltersOpen(false);
                    setMoreFilterSelected(null);
                  }}
                >
                  Apply
                </Button>
              </div>
            </div>
          ) : (
            <div className="p-2.5">
              <div className="flex items-center gap-2 mb-3">
                <button
                  type="button"
                  onClick={() => setMoreFilterSelected(null)}
                  className="flex items-center justify-center w-7 h-7 rounded-md hover:bg-[rgb(245,245,245)] text-[rgb(100,100,100)]"
                  aria-label="Back"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <h4 className="font-semibold text-[11px] text-[rgb(64,64,64)]">
                  Filter by: Created date
                </h4>
              </div>
              <div className="space-y-2">
                <p className="text-[11px] font-medium text-[rgb(100,100,100)]">
                  is in the last
                </p>
                <div className="flex gap-2">
                  <Input
                    value={draftCreatedValue}
                    onChange={(e) => setDraftCreatedValue(e.target.value)}
                    className="h-8 text-xs w-20"
                    placeholder="30"
                  />
                  <Select
                    value={draftCreatedUnit}
                    onValueChange={(val: "days" | "weeks" | "months") =>
                      setDraftCreatedUnit(val)
                    }
                  >
                    <SelectTrigger className="h-8 text-xs flex-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="days">days</SelectItem>
                      <SelectItem value="weeks">weeks</SelectItem>
                      <SelectItem value="months">months</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex justify-end mt-3">
                <Button
                  size="sm"
                  className="h-7 px-2.5 text-[11px] bg-[#695eff] hover:bg-[#5547e8]"
                  onClick={() => {
                    const v = parseInt(draftCreatedValue, 10);
                    if (!Number.isNaN(v) && v > 0) {
                      setCreatedDateFilter({
                        mode: "inLast",
                        value: v,
                        unit: draftCreatedUnit,
                      });
                    } else {
                      setCreatedDateFilter(null);
                    }
                    setMoreFiltersOpen(false);
                    setMoreFilterSelected(null);
                  }}
                >
                  Apply
                </Button>
              </div>
            </div>
          )}
        </PopoverContent>
      </Popover>

      {/* Active "More filters" chips (position, phone, created date) */}
      {positionFilter.trim() !== "" && (
        <button
          type="button"
          className="inline-flex items-center gap-1 h-7 px-2 rounded-xl text-[11px] font-semibold text-[rgb(64,64,64)] bg-white border border-[#DDDDDD] border-solid transition-colors hover:bg-[rgb(250,250,250)]"
          onClick={() => {
            setMoreFiltersOpen(true);
            setMoreFilterSelected("position");
            setDraftPosition(positionFilter);
          }}
        >
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              setPositionFilter("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                setPositionFilter("");
              }
            }}
            className="flex items-center justify-center w-3.5 h-3.5 rounded-full hover:bg-[rgb(230,230,230)] text-[rgb(100,100,100)] cursor-pointer"
            aria-label="Clear position filter"
          >
            <X className="h-2 w-2" />
          </span>
          <span className="text-[rgb(133,133,133)] font-semibold">Position</span>
          <span className="font-semibold max-w-[140px] truncate">
            {positionFilter}
          </span>
        </button>
      )}

      {phoneFilter.trim() !== "" && (
        <button
          type="button"
          className="inline-flex items-center gap-1 h-7 px-2 rounded-xl text-[11px] font-semibold text-[rgb(64,64,64)] bg-white border border-[#DDDDDD] border-solid transition-colors hover:bg-[rgb(250,250,250)]"
          onClick={() => {
            setMoreFiltersOpen(true);
            setMoreFilterSelected("phone");
            setDraftPhone(phoneFilter);
          }}
        >
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              setPhoneFilter("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                setPhoneFilter("");
              }
            }}
            className="flex items-center justify-center w-3.5 h-3.5 rounded-full hover:bg-[rgb(230,230,230)] text-[rgb(100,100,100)] cursor-pointer"
            aria-label="Clear phone filter"
          >
            <X className="h-2 w-2" />
          </span>
          <span className="text-[rgb(133,133,133)] font-semibold">
            Phone number
          </span>
          <span className="font-semibold max-w-[140px] truncate">
            {phoneFilter}
          </span>
        </button>
      )}

      {createdDateFilter && (
        <button
          type="button"
          className="inline-flex items-center gap-1 h-7 px-2 rounded-xl text-[11px] font-semibold text-[rgb(64,64,64)] bg-white border border-[#DDDDDD] border-solid transition-colors hover:bg-[rgb(250,250,250)]"
          onClick={() => {
            setMoreFiltersOpen(true);
            setMoreFilterSelected("createdDate");
            setDraftCreatedValue(createdDateFilter.value.toString());
            setDraftCreatedUnit(createdDateFilter.unit);
          }}
        >
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              setCreatedDateFilter(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                setCreatedDateFilter(null);
              }
            }}
            className="flex items-center justify-center w-3.5 h-3.5 rounded-full hover:bg-[rgb(230,230,230)] text-[rgb(100,100,100)] cursor-pointer"
            aria-label="Clear created date filter"
          >
            <X className="h-2 w-2" />
          </span>
          <span className="text-[rgb(133,133,133)] font-semibold">
            Created date
          </span>
          <span className="font-semibold max-w-[140px] truncate">
            {createdDateSummary}
          </span>
        </button>
      )}

      {hasActiveFilters ? (
        <button
          type="button"
          onClick={handleClearFilters}
          className="text-[11px] font-semibold text-[#695eff] hover:text-[#5547e8] shrink-0"
        >
          Clear filters
        </button>
      ) : null}
    </>
  );

  if (stackedLayout) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {searchInput}
          {extraAction}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          {filterChips}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-2 flex-wrap">
      {searchInput}
      {filterChips}
    </div>
  );
}
