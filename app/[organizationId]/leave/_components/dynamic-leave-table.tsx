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
import { getStatusBadgeClass, getStatusBadgeStyle } from "@/utils/colors";

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

interface DynamicLeaveTableProps {
  leaveRequests: any[];
  columns: Column[];
  employees?: any[];
  onRowClick?: (request: any) => void;
  pageSize?: number;
}

type SortDirection = "asc" | "desc" | null;
type SortState = { field: string; direction: SortDirection };

export function DynamicLeaveTable({
  leaveRequests,
  columns,
  employees,
  onRowClick,
  pageSize = 0,
}: DynamicLeaveTableProps) {
  const [sortState, setSortState] = useState<SortState>({
    field: "",
    direction: null,
  });
  const [currentPage, setCurrentPage] = useState(1);
  const effectivePageSize = pageSize > 0 ? pageSize : PAGE_SIZE_DEFAULT;
  const isPaginated = pageSize > 0;

  const getFieldValue = (request: any, field: string): any => {
    // Handle custom fields
    if (field.startsWith("custom.")) {
      const customFieldKey = field.replace("custom.", "");
      return request.customFields?.[customFieldKey] || null;
    }

    // Handle nested paths like "employee.personalInfo.firstName"
    const parts = field.split(".");
    let value: any = request;
    for (const part of parts) {
      if (part === "employee" && employees) {
        const employee = employees.find(
          (e: any) => e._id === request.employeeId
        );
        if (employee) {
          value = employee;
          continue;
        }
      }
      value = value?.[part];
      if (value === undefined || value === null) return null;
    }
    return value;
  };

  const formatCellValue = (
    value: any,
    column: Column,
    request: any
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
        if (status === "approved") {
          return (
            <Badge className="bg-[#DCF7DC] border-[#A1E6A1] text-[#2E892E] font-normal rounded-md hover:bg-[#DCF7DC] focus:ring-0 focus:ring-offset-0 transition-none">
              {String(value)}
            </Badge>
          );
        }
        if (status === "rejected") {
          return (
            <Badge className="bg-red-100 text-red-800 border-red-300 font-normal rounded-md hover:bg-red-100 focus:ring-0 focus:ring-offset-0 transition-none">
              {String(value)}
            </Badge>
          );
        }
        if (status === "cancelled") {
          return (
            <Badge className="bg-gray-100 text-gray-800 hover:bg-gray-100 border-gray-200 rounded-md focus:ring-0 focus:ring-offset-0 transition-none font-normal">
              {String(value)}
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

  const sortedRequests = useMemo(() => {
    if (!sortState.field || !sortState.direction) {
      return leaveRequests;
    }

    const column = columns.find((c) => c.field === sortState.field);
    if (!column || column.sortable === false) {
      return leaveRequests;
    }

    const sorted = [...leaveRequests].sort((a, b) => {
      let aValue = getFieldValue(a, sortState.field);
      let bValue = getFieldValue(b, sortState.field);

      // Handle special "employee" field - sort by employee name
      if (sortState.field === "employee" && employees) {
        const aEmployee = employees.find((e: any) => e._id === a.employeeId);
        const bEmployee = employees.find((e: any) => e._id === b.employeeId);
        aValue = aEmployee
          ? `${aEmployee.personalInfo?.firstName || ""} ${aEmployee.personalInfo?.lastName || ""}`.trim()
          : "Unknown";
        bValue = bEmployee
          ? `${bEmployee.personalInfo?.firstName || ""} ${bEmployee.personalInfo?.lastName || ""}`.trim()
          : "Unknown";
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
          const aStr = String(aValue).toLowerCase();
          const bStr = String(bValue).toLowerCase();
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
  }, [leaveRequests, sortState, columns, employees]);

  const totalPages = Math.max(
    1,
    Math.ceil(sortedRequests.length / effectivePageSize)
  );
  const displayRequests = useMemo(() => {
    if (!isPaginated) return sortedRequests;
    const from = (currentPage - 1) * effectivePageSize;
    return sortedRequests.slice(from, from + effectivePageSize);
  }, [sortedRequests, isPaginated, currentPage, effectivePageSize]);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(1);
  }, [totalPages, currentPage]);

  const getSortIcon = (field: string) => {
    if (sortState.field !== field) {
      return <ArrowUpDown className="h-4 w-4 ml-1 opacity-50" />;
    }
    if (sortState.direction === "asc") {
      return <ArrowUp className="h-4 w-4 ml-1" />;
    }
    return <ArrowDown className="h-4 w-4 ml-1" />;
  };

  // Filter out hidden columns so we only render those that should be visible
  const visibleColumns = columns.filter((col) => !col.hidden);

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
          {displayRequests.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={visibleColumns.length}
                className="text-center text-gray-500"
              >
                No leave requests found
              </TableCell>
            </TableRow>
          ) : (
            displayRequests.map((request) => {
              return (
                <TableRow
                  key={request._id}
                  className={
                    onRowClick ? "cursor-pointer hover:bg-gray-50" : ""
                  }
                  onClick={() => onRowClick?.(request)}
                >
                  {visibleColumns.map((column) => {
                    let value: any = getFieldValue(request, column.field);

                    // Handle special cases
                    if (column.field === "employee" && employees) {
                      const employee = employees.find(
                        (e: any) => e._id === request.employeeId
                      );
                      value = employee
                        ? `${employee.personalInfo?.firstName || ""} ${
                            employee.personalInfo?.lastName || ""
                          }`.trim()
                        : "Unknown";
                    } else if (column.field === "leaveType") {
                      value = request.leaveType;
                    } else if (column.field === "startDate") {
                      value = request.startDate;
                    } else if (column.field === "endDate") {
                      value = request.endDate;
                    } else if (
                      column.field === "numberOfDays" ||
                      column.field === "days"
                    ) {
                      value = request.numberOfDays;
                    } else if (column.field === "status") {
                      value = request.status;
                    } else if (column.field === "reason") {
                      value = request.reason;
                    } else if (column.field === "filedDate") {
                      value = request.filedDate;
                    }

                    return (
                      <TableCell
                        key={column.id}
                        style={{ width: column.width }}
                      >
                        {formatCellValue(value, column, request)}
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
      {isPaginated && sortedRequests.length > 0 && (
        <div className="flex items-center justify-between gap-4 px-4 py-3 border-t border-[rgb(230,230,230)] bg-[rgb(250,250,250)]">
          <p className="text-xs font-medium text-[rgb(133,133,133)]">
            {(currentPage - 1) * effectivePageSize + 1}–
            {Math.min(currentPage * effectivePageSize, sortedRequests.length)}{" "}
            of {sortedRequests.length}
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
