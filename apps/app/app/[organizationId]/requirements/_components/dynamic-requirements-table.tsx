"use client";

import { useState } from "react";
import { format } from "date-fns";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  summarizeEmployeeRequirements,
  type RequirementPolicy,
} from "@/lib/requirements/workflow";
import {
  getApplicableEmployeeRequirements,
  type RequirementsColumn,
  type RequirementsEmployee,
} from "@/lib/requirements/ui-types";
import { getUnknownField } from "@/lib/recruitment/ui-types";

interface DynamicRequirementsTableProps {
  employees: RequirementsEmployee[];
  policies: readonly RequirementPolicy[];
  columns: RequirementsColumn[];
  onRowClick: (employee: RequirementsEmployee) => void;
  pageSize?: number;
  isLoading?: boolean;
}

type SortDirection = "asc" | "desc" | null;

export function DynamicRequirementsTable({
  employees,
  policies,
  columns,
  onRowClick,
  pageSize = 20,
  isLoading = false,
}: DynamicRequirementsTableProps) {
  const [sort, setSort] = useState<{ field: string; direction: SortDirection }>(
    { field: "", direction: null },
  );
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(employees.length / pageSize));
  const visibleColumns = columns.filter((column) => !column.hidden);

  const safePage = Math.min(page, totalPages);

  function requirementsFor(employee: RequirementsEmployee) {
    return getApplicableEmployeeRequirements(employee, policies).map(
      (item) => item.requirement,
    );
  }

  function fieldValue(employee: RequirementsEmployee, field: string): unknown {
    if (field === "name" || field === "personalInfo.firstName") {
      return `${employee.personalInfo.firstName} ${employee.personalInfo.lastName}`.trim();
    }
    if (field === "status") {
      return summarizeEmployeeRequirements(requirementsFor(employee))
        .completionPercent;
    }
    return getUnknownField(employee, field);
  }

  const sortedEmployees = (() => {
    if (!sort.field || !sort.direction) return employees;
    const direction = sort.direction === "asc" ? 1 : -1;
    return [...employees].sort((left, right) => {
      const leftValue = fieldValue(left, sort.field);
      const rightValue = fieldValue(right, sort.field);
      if (leftValue === undefined || leftValue === null) return 1;
      if (rightValue === undefined || rightValue === null) return -1;
      if (typeof leftValue === "number" && typeof rightValue === "number") {
        return (leftValue - rightValue) * direction;
      }
      return (
        String(leftValue).localeCompare(String(rightValue), undefined, {
          numeric: true,
          sensitivity: "base",
        }) * direction
      );
    });
  })();

  const pageEmployees = sortedEmployees.slice(
    (safePage - 1) * pageSize,
    safePage * pageSize,
  );

  function toggleSort(field: string) {
    setSort((current) => {
      if (current.field !== field) return { field, direction: "asc" };
      if (current.direction === "asc") return { field, direction: "desc" };
      return { field: "", direction: null };
    });
  }

  function renderValue(
    employee: RequirementsEmployee,
    column: RequirementsColumn,
  ) {
    if (column.field === "status") {
      const summary = summarizeEmployeeRequirements(requirementsFor(employee));
      const needsAction =
        summary.missing +
        summary.awaitingReview +
        summary.rejected +
        summary.expired;
      return (
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant={needsAction === 0 ? "default" : "secondary"}
            className={needsAction === 0 ? "bg-emerald-600" : ""}
          >
            {summary.completionPercent}% complete
          </Badge>
          {summary.awaitingReview > 0 && (
            <span className="text-xs font-medium text-amber-700">
              {summary.awaitingReview} to review
            </span>
          )}
          {summary.expired > 0 && (
            <span className="text-xs font-medium text-red-700">
              {summary.expired} expired
            </span>
          )}
        </div>
      );
    }
    const value = fieldValue(employee, column.field);
    if (value === undefined || value === null || value === "")
      return <span className="text-[#AAA5B0]">—</span>;
    if (column.type === "date" && typeof value === "number")
      return format(new Date(value), "MMM d, yyyy");
    return String(value);
  }

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, index) => (
          <div
            key={index}
            className="h-12 animate-pulse rounded-lg bg-[#F2F0F5]"
          />
        ))}
      </div>
    );
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            {visibleColumns.map((column) => (
              <TableHead
                key={column.id}
                style={{ width: column.width }}
                onClick={() =>
                  column.sortable !== false && toggleSort(column.field)
                }
                className={
                  column.sortable !== false ? "cursor-pointer select-none" : ""
                }
              >
                <span className="inline-flex items-center">
                  {column.label}
                  {column.sortable !== false &&
                    (sort.field !== column.field ? (
                      <ArrowUpDown className="ml-1 h-3 w-3 opacity-40" />
                    ) : sort.direction === "asc" ? (
                      <ArrowUp className="ml-1 h-3 w-3" />
                    ) : (
                      <ArrowDown className="ml-1 h-3 w-3" />
                    ))}
                </span>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {pageEmployees.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={visibleColumns.length}
                className="py-10 text-center text-[#928C99]"
              >
                No employees match this queue.
              </TableCell>
            </TableRow>
          ) : (
            pageEmployees.map((employee) => (
              <TableRow
                key={employee._id}
                className="cursor-pointer hover:bg-[#FAF9FD]"
                onClick={() => onRowClick(employee)}
              >
                {visibleColumns.map((column) => (
                  <TableCell key={column.id}>
                    {renderValue(employee, column)}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      {employees.length > pageSize && (
        <div className="flex items-center justify-between border-t bg-[#FAF9FD] px-4 py-3">
          <p className="text-xs text-[#77727F]">
            {(safePage - 1) * pageSize + 1}–
            {Math.min(safePage * pageSize, employees.length)} of{" "}
            {employees.length}
          </p>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              disabled={safePage === 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              disabled={safePage === totalPages}
              onClick={() =>
                setPage((current) => Math.min(totalPages, current + 1))
              }
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
