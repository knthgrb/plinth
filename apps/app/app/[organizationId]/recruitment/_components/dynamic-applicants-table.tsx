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
  Link as LinkIcon,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { format } from "date-fns";

const PAGE_SIZE_DEFAULT = 20;

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

interface DynamicApplicantsTableProps {
  applicants: any[];
  columns: Column[];
  onRowClick: (applicant: any) => void;
  pageSize?: number;
}

type SortDirection = "asc" | "desc" | null;
type SortState = { field: string; direction: SortDirection };

export function DynamicApplicantsTable({
  applicants,
  columns,
  onRowClick,
  pageSize = PAGE_SIZE_DEFAULT,
}: DynamicApplicantsTableProps) {
  const [sortState, setSortState] = useState<SortState>({
    field: "",
    direction: null,
  });
  const [currentPage, setCurrentPage] = useState(1);

  const totalPages = Math.max(1, Math.ceil(applicants.length / pageSize));
  const from = (currentPage - 1) * pageSize;

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(1);
  }, [totalPages, currentPage]);

  const getFieldValue = (applicant: any, field: string): any => {
    // Handle custom fields
    if (field.startsWith("custom.")) {
      const customFieldKey = field.replace("custom.", "");
      return applicant.customFields?.[customFieldKey] || null;
    }

    const parts = field.split(".");
    let value: any = applicant;
    for (const part of parts) {
      value = value?.[part];
      if (value === undefined || value === null) return null;
    }
    return value;
  };

  const formatCellValue = (
    value: any,
    column: Column,
    applicant: any
  ): React.ReactNode => {
    // Resume: show "Yes" / "—" (value is storage ID)
    if (column.field === "resume") {
      return value ? (
        <span className="text-[rgb(64,64,64)]">Yes</span>
      ) : (
        <span className="text-gray-400">—</span>
      );
    }
    // Notes: show count or "—" (value is array)
    if (column.field === "notes") {
      const count = Array.isArray(value) ? value.length : 0;
      return count > 0 ? (
        <span className="text-[rgb(64,64,64)]">
          {count} note{count !== 1 ? "s" : ""}
        </span>
      ) : (
        <span className="text-gray-400">—</span>
      );
    }

    if (value === null || value === undefined) {
      return <span className="text-gray-400">—</span>;
    }

    switch (column.type) {
      case "number":
        if (typeof value === "number") {
          // Format as currency if it's a salary field
          if (
            column.field.includes("Salary") ||
            column.field.includes("salary")
          ) {
            return new Intl.NumberFormat("en-PH", {
              style: "currency",
              currency: "PHP",
            }).format(value);
          }
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
              className="text-blue-600 hover:underline inline-flex items-center"
            >
              <LinkIcon className="h-4 w-4 mr-1" />
              Link
            </a>
          );
        }
        return <span className="text-gray-400">—</span>;
      case "badge":
        const status = String(value).toLowerCase();
        if (status === "hired" || status === "complete") {
          return (
            <Badge variant="default" className="bg-green-600">
              {String(value)}
            </Badge>
          );
        }
        if (status === "rejected" || status === "incomplete") {
          return <Badge variant="destructive">{String(value)}</Badge>;
        }
        return <Badge variant="secondary">{String(value)}</Badge>;
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

  const sortedApplicants = useMemo(() => {
    if (!sortState.field || !sortState.direction) {
      return applicants;
    }

    const column = columns.find((c) => c.field === sortState.field);
    if (!column || column.sortable === false) {
      return applicants;
    }

    const sorted = [...applicants].sort((a, b) => {
      let aValue = getFieldValue(a, sortState.field);
      let bValue = getFieldValue(b, sortState.field);

      // Handle special "Name" column
      if (sortState.field === "name" || sortState.field === "firstName") {
        aValue = `${a.firstName || ""} ${a.lastName || ""}`.trim();
        bValue = `${b.firstName || ""} ${b.lastName || ""}`.trim();
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
          // Handle currency strings (e.g., "PHP 50,000.00" or "₱50,000")
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
  }, [applicants, sortState, columns]);

  const sortedForPage = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedApplicants.slice(start, start + pageSize);
  }, [sortedApplicants, currentPage, pageSize]);

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
                No applicants found
              </TableCell>
            </TableRow>
          ) : (
            sortedForPage.map((applicant) => {
              return (
                <TableRow
                  key={applicant._id}
                  className="cursor-pointer hover:bg-gray-50"
                  onClick={() => onRowClick(applicant)}
                >
                  {visibleColumns.map((column) => {
                    let value: any;

                    // Handle special "Name" column
                    if (
                      column.field === "name" ||
                      column.field === "firstName"
                    ) {
                      value = `${applicant.firstName} ${applicant.lastName}`;
                    } else {
                      value = getFieldValue(applicant, column.field);
                      // Handle custom fields
                      if (
                        value === null &&
                        column.field.startsWith("custom.")
                      ) {
                        const customFieldKey = column.field.replace(
                          "custom.",
                          ""
                        );
                        value =
                          applicant.customFields?.[customFieldKey] || null;
                      }
                    }

                    return (
                      <TableCell
                        key={column.id}
                        style={{ width: column.width }}
                      >
                        {formatCellValue(value, column, applicant)}
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
      {applicants.length > pageSize && applicants.length > 0 && (
        <div className="flex items-center justify-between gap-4 px-4 py-3 border-t border-[rgb(230,230,230)] bg-[rgb(250,250,250)]">
          <p className="text-xs font-medium text-[rgb(133,133,133)]">
            {from + 1}–{Math.min(from + pageSize, applicants.length)} of{" "}
            {applicants.length}
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
