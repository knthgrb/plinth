"use client";

import { format } from "date-fns";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Banknote,
  CheckCircle,
  Eye,
  FileText,
  Loader2,
  MoreHorizontal,
  Pencil,
  Trash2,
  Undo2,
} from "lucide-react";
import { getStatusBadgeClass, getStatusBadgeStyle } from "@/utils/colors";

interface PayrollRunsTableProps {
  payrollRuns: any[];
  isLoading?: boolean;
  onViewSummary: (run: any) => void;
  onViewPayslips: (run: any) => void;
  onEdit: (run: any) => void;
  onRegeneratePayslips?: (run: any) => void | Promise<void>;
  /** When set, shows spinner on that run's "Regenerate payslips" action */
  regeneratingPayrollRunId?: string | null;
  onStatusChange: (run: any, status: string) => void;
  onDelete: (run: any) => void;
}

export function PayrollRunsTable({
  payrollRuns,
  isLoading = false,
  onViewSummary,
  onViewPayslips,
  onEdit,
  onRegeneratePayslips,
  regeneratingPayrollRunId = null,
  onStatusChange,
  onDelete,
}: PayrollRunsTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Period</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Processed Date</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <TableRow key={`sk-${i}`}>
              <TableCell>
                <div className="h-4 w-40 max-w-full rounded bg-gray-200 animate-pulse" />
              </TableCell>
              <TableCell>
                <div className="h-6 w-20 rounded-full bg-gray-200 animate-pulse" />
              </TableCell>
              <TableCell>
                <div className="h-4 w-28 rounded bg-gray-200 animate-pulse" />
              </TableCell>
              <TableCell className="text-right">
                <div className="ml-auto h-8 w-8 rounded bg-gray-200 animate-pulse" />
              </TableCell>
            </TableRow>
          ))
        ) : payrollRuns?.length === 0 ? (
          <TableRow>
            <TableCell colSpan={4} className="text-center text-gray-500">
              No payroll runs found
            </TableCell>
          </TableRow>
        ) : (
          payrollRuns?.map((run) => {
            const is13thMonth = (run.runType ?? "regular") === "13th_month";
            const hasCutoffs = run.cutoffStart && run.cutoffEnd;
            const periodDisplay = is13thMonth
              ? run.period || `13th Month Pay ${run.year ?? ""}`
              : hasCutoffs
                ? `${format(new Date(run.cutoffStart), "MMM. dd, yyyy")} - ${format(
                    new Date(run.cutoffEnd),
                    "MMM. dd, yyyy",
                  )}`
                : run.period;

            return (
              <TableRow key={run._id}>
                <TableCell>{periodDisplay}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="secondary"
                      className={getStatusBadgeClass(run.status)}
                      style={getStatusBadgeStyle(run.status)}
                    >
                      {run.status === "paid"
                        ? "Paid"
                        : run.status === "finalized"
                          ? "Finalized"
                          : run.status === "archived"
                            ? "Archived"
                            : run.status}
                    </Badge>
                    {run.status === "draft" && run.isDraftOutdated && (
                      <Badge
                        variant="secondary"
                        className="bg-amber-100 text-amber-700 border border-amber-200"
                      >
                        Outdated
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  {run.processedAt
                    ? format(new Date(run.processedAt), "MMM dd, yyyy")
                    : "-"}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex gap-2 justify-end">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => onViewSummary(run)}>
                          <FileText className="h-4 w-4 mr-2" />
                          View Summary
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onViewPayslips(run)}>
                          <Eye className="h-4 w-4 mr-2" />
                          View Payslips
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {run.status === "draft" && (
                          <>
                            {(run.runType ?? "regular") !== "13th_month" && (
                              <>
                                <DropdownMenuItem onClick={() => onEdit(run)}>
                                  <Pencil className="h-4 w-4 mr-2" />
                                  Edit
                                </DropdownMenuItem>
                                {onRegeneratePayslips && (
                                  <DropdownMenuItem
                                    disabled={!!regeneratingPayrollRunId}
                                    onClick={() => void onRegeneratePayslips(run)}
                                  >
                                    {regeneratingPayrollRunId === run._id ? (
                                      <Loader2 className="h-4 w-4 mr-2 animate-spin shrink-0" />
                                    ) : (
                                      <FileText className="h-4 w-4 mr-2" />
                                    )}
                                    {regeneratingPayrollRunId === run._id
                                      ? "Regenerating…"
                                      : "Regenerate payslips"}
                                  </DropdownMenuItem>
                                )}
                              </>
                            )}
                            <DropdownMenuItem
                              disabled={run.isDraftOutdated}
                              onClick={() => onStatusChange(run, "finalized")}
                            >
                              <CheckCircle className="h-4 w-4 mr-2" />
                              {run.isDraftOutdated
                                ? "Finalize (regenerate required)"
                                : "Finalize"}
                            </DropdownMenuItem>
                          </>
                        )}
                        {run.status === "finalized" && (
                          <>
                            <DropdownMenuItem
                              onClick={() => onStatusChange(run, "paid")}
                            >
                              <Banknote className="h-4 w-4 mr-2" />
                              Mark as Paid
                            </DropdownMenuItem>
                          </>
                        )}
                        {run.status === "paid" && (
                          <DropdownMenuItem
                            onClick={() => onStatusChange(run, "finalized")}
                          >
                            <Undo2 className="h-4 w-4 mr-2" />
                            Revert to Finalized
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            onDelete(run);
                          }}
                          className="text-red-600"
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete Run
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </TableCell>
              </TableRow>
            );
          })
        )}
      </TableBody>
    </Table>
  );
}
