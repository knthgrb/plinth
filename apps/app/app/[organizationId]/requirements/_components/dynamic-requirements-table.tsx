"use client";

import { useState, useMemo, useEffect } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { format } from "date-fns";

interface Column {
  id: string;
  label: string;
  field: string;
  type: "text" | "number" | "date" | "badge" | "link";
  sortable?: boolean;
  width?: string;
  customField?: boolean;
  isDefault?: boolean;
  hidden?: boolean;
}

const PAGE_SIZE_DEFAULT = 20;

interface DynamicRequirementsTableProps {
  employees: any[];
  columns: Column[];
  onRowClick: (employee: any) => void;
  pageSize?: number;
}

type SortDirection = "asc" | "desc" | null;
type SortState = { field: string; direction: SortDirection };

export function DynamicRequirementsTable({
  employees,
  columns,
  onRowClick,
  pageSize = PAGE_SIZE_DEFAULT,
}: DynamicRequirementsTableProps) {
  const [sortState, setSortState] = useState<SortState>({
    field: "",
    direction: null,
  });
  const [currentPage, setCurrentPage] = useState(1);

  const totalPages = Math.max(1, Math.ceil(employees.length / pageSize));
  const from = (currentPage - 1) * pageSize;

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(1);
  }, [totalPages, currentPage]);

  const getFieldValue = (employee: any, field: string): any => {
    // Handle custom fields
    if (field.startsWith("custom.")) {
      const customFieldKey = field.replace("custom.", "");
      return employee.customFields?.[customFieldKey] || null;
    }

    // Handle nested paths like "personalInfo.firstName"
    const parts = field.split(".");
    let value: any = employee;
    for (const part of parts) {
      value = value?.[part];
      if (value === undefined || value === null) return null;
    }
    return value;
  };

  const formatCellValue = (
    value: any,
    column: Column,
    employee: any
  ): React.ReactNode => {
    if (value === null || value === undefined) {
      return <span className="text-gray-400">—</span>;
    }

    switch (column.type) {
      case "number":
        if (typeof value === "number") {
          return value.toLocaleString();
        }
        return String(value);
      case "date":
        if (typeof value === "number") {
          return format(new Date(value), "MMM dd, yyyy");
        }
        return String(value);
      case "link":
        if (value && typeof value === "string" && value.startsWith("http")) {
          return (
            <a
              href={value}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-blue-600 hover:underline"
            >
              Link
            </a>
          );
        }
        return <span className="text-gray-400">—</span>;
      case "badge":
        const status = String(value).toLowerCase();
        // Handle "Complete" status (all requirements verified)
        if (status === "complete" || status === "verified") {
          return (
            <Badge className="bg-[#DCF7DC] border-[#A1E6A1] text-[#2E892E] font-normal rounded-md hover:bg-[#DCF7DC] focus:ring-0 focus:ring-offset-0 transition-none">
              Complete
            </Badge>
          );
        }
        // Handle "Incomplete" status
        if (status === "incomplete" || status === "not passed") {
          return (
            <Badge className="bg-red-100 text-red-800 border-red-300 font-normal rounded-md hover:bg-red-100 focus:ring-0 focus:ring-offset-0 transition-none">
              Incomplete
            </Badge>
          );
        }
        return (
          <Badge className="bg-gray-100 text-gray-800 hover:bg-gray-100 border-gray-200 rounded-md focus:ring-0 focus:ring-offset-0 transition-none font-normal">
            {String(value)}
          </Badge>
        );
      default:
        return String(value);
    }
  };

  const handleSort = (field: string) => {
    setSortState((prev) => {
      if (prev.field === field) {
        if (prev.direction === "asc") {
          return { field, direction: "desc" };
        } else if (prev.direction === "desc") {
          return { field: "", direction: null };
        }
      }
      return { field, direction: "asc" };
    });
  };

  const sortedEmployees = useMemo(() => {
    if (!sortState.field || !sortState.direction) {
      return employees;
    }

    const column = columns.find((c) => c.field === sortState.field);
    if (!column || column.sortable === false) {
      return employees;
    }

    const sorted = [...employees].sort((a, b) => {
      let aValue = getFieldValue(a, sortState.field);
      let bValue = getFieldValue(b, sortState.field);

      // Handle special "status" column - calculate from requirements
      if (sortState.field === "status") {
        const aRequirements = a.requirements || [];
        const bRequirements = b.requirements || [];
        const aAllPassed =
          aRequirements.length > 0 &&
          aRequirements.every((r: any) => r.status === "verified");
        const bAllPassed =
          bRequirements.length > 0 &&
          bRequirements.every((r: any) => r.status === "verified");
        aValue = aAllPassed ? "Complete" : "Incomplete";
        bValue = bAllPassed ? "Complete" : "Incomplete";
      }

      // Handle special "name" column
      if (
        sortState.field === "name" ||
        sortState.field === "personalInfo.firstName"
      ) {
        aValue =
          `${a.personalInfo?.firstName || ""} ${a.personalInfo?.lastName || ""}`.trim();
        bValue =
          `${b.personalInfo?.firstName || ""} ${b.personalInfo?.lastName || ""}`.trim();
      }

      // Handle null/undefined values - both nulls are equal
      const aIsNull = aValue === null || aValue === undefined || aValue === "";
      const bIsNull = bValue === null || bValue === undefined || bValue === "";
      if (aIsNull && bIsNull) return 0;
      if (aIsNull) return 1; // nulls go to end
      if (bIsNull) return -1;

      // Compare based on column type
      switch (column.type) {
        case "number": {
          // Handle currency strings (e.g., "PHP 50,000.00")
          const aNum =
            typeof aValue === "string"
              ? parseFloat(aValue.replace(/[^0-9.-]/g, "")) || 0
              : Number(aValue) || 0;
          const bNum =
            typeof bValue === "string"
              ? parseFloat(bValue.replace(/[^0-9.-]/g, "")) || 0
              : Number(bValue) || 0;
          return sortState.direction === "asc" ? aNum - bNum : bNum - aNum;
        }
        case "date": {
          // Handle timestamps (numbers), Date objects, and date strings
          let aDate: number;
          let bDate: number;

          if (typeof aValue === "number") {
            aDate = aValue;
          } else if (aValue instanceof Date) {
            aDate = aValue.getTime();
          } else {
            aDate = new Date(aValue as string).getTime() || 0;
          }

          if (typeof bValue === "number") {
            bDate = bValue;
          } else if (bValue instanceof Date) {
            bDate = bValue.getTime();
          } else {
            bDate = new Date(bValue as string).getTime() || 0;
          }

          return sortState.direction === "asc" ? aDate - bDate : bDate - aDate;
        }
        case "badge": {
          // Badge values are strings, sort alphabetically
          // Special handling for status badges: Complete comes before Incomplete
          const aStr = String(aValue).toLowerCase();
          const bStr = String(bValue).toLowerCase();

          // Custom order for status badges
          if (aStr === "complete" && bStr === "incomplete") {
            return sortState.direction === "asc" ? -1 : 1;
          }
          if (aStr === "incomplete" && bStr === "complete") {
            return sortState.direction === "asc" ? 1 : -1;
          }

          return sortState.direction === "asc"
            ? aStr.localeCompare(bStr)
            : bStr.localeCompare(aStr);
        }
        case "link": {
          // Links are strings (URLs), sort alphabetically
          const aStr = String(aValue).toLowerCase();
          const bStr = String(bValue).toLowerCase();
          return sortState.direction === "asc"
            ? aStr.localeCompare(bStr)
            : bStr.localeCompare(aStr);
        }
        case "text":
        default: {
          // Text comparison with locale-aware sorting
          const aStr = String(aValue).toLowerCase();
          const bStr = String(bValue).toLowerCase();
          return sortState.direction === "asc"
            ? aStr.localeCompare(bStr, undefined, {
                numeric: true,
                sensitivity: "base",
              })
            : bStr.localeCompare(aStr, undefined, {
                numeric: true,
                sensitivity: "base",
              });
        }
      }
    });

    return sorted;
  }, [employees, sortState, columns]);

  const getSortIcon = (field: string) => {
    if (sortState.field !== field) {
      return <ArrowUpDown className="h-4 w-4 ml-1 opacity-50" />;
    }
    if (sortState.direction === "asc") {
      return <ArrowUp className="h-4 w-4 ml-1" />;
    }
    return <ArrowDown className="h-4 w-4 ml-1" />;
  };

  // Filter out hidden columns
  const visibleColumns = columns.filter((col) => !col.hidden);
  const sortedForPage = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedEmployees.slice(start, start + pageSize);
  }, [sortedEmployees, currentPage, pageSize]);

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            {visibleColumns.map((column) => (
              <TableHead
                key={column.id}
                style={{ width: column.width }}
                className={
                  column.sortable !== false ? "cursor-pointer select-none" : ""
                }
                onClick={() =>
                  column.sortable !== false && handleSort(column.field)
                }
              >
                <div className="flex items-center">
                  {column.label}
                  {column.sortable !== false && getSortIcon(column.field)}
                </div>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedForPage.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={visibleColumns.length}
                className="text-center text-gray-500"
              >
                No employees found
              </TableCell>
            </TableRow>
          ) : (
            sortedForPage.map((employee) => {
              const requirements = employee.requirements || [];
              const allPassed = requirements.every(
                (r: any) => r.status === "verified"
              );
              const statusValue = allPassed ? "Complete" : "Incomplete";

              return (
                <TableRow
                  key={employee._id}
                  className="cursor-pointer hover:bg-gray-50"
                  onClick={() => onRowClick(employee)}
                >
                  {visibleColumns.map((column) => {
                    let value: any;

                    // Handle special "Name" column
                    if (
                      column.field === "name" ||
                      column.field === "personalInfo.firstName"
                    ) {
                      value = `${employee.personalInfo?.firstName || ""} ${
                        employee.personalInfo?.lastName || ""
                      }`.trim();
                    } else if (column.field === "status") {
                      value = statusValue;
                    } else {
                      value = getFieldValue(employee, column.field);
                    }

                    return (
                      <TableCell
                        key={column.id}
                        style={{ width: column.width }}
                      >
                        {formatCellValue(value, column, employee)}
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
      {employees.length > pageSize && employees.length > 0 && (
        <div className="flex items-center justify-between gap-4 px-4 py-3 border-t border-[rgb(230,230,230)] bg-[rgb(250,250,250)]">
          <p className="text-xs font-medium text-[rgb(133,133,133)]">
            {from + 1}–{Math.min(from + pageSize, employees.length)} of{" "}
            {employees.length}
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0 border-[rgb(230,230,230)]"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0 border-[rgb(230,230,230)]"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
