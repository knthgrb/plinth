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
  MoreHorizontal,
  Pencil,
  Trash2,
  Undo2,
} from "lucide-react";
import { getStatusBadgeClass, getStatusBadgeStyle } from "@/utils/colors";

interface PayrollRunsTableProps {
  payrollRuns: any[];
  onViewSummary: (run: any) => void;
  onViewPayslips: (run: any) => void;
  onEdit: (run: any) => void;
  onStatusChange: (run: any, status: string) => void;
  onDelete: (run: any) => void;
}

export function PayrollRunsTable({
  payrollRuns,
  onViewSummary,
  onViewPayslips,
  onEdit,
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
        {payrollRuns?.length === 0 ? (
          <TableRow>
            <TableCell colSpan={4} className="text-center text-gray-500">
              No payroll runs found
            </TableCell>
          </TableRow>
        ) : (
          payrollRuns?.map((run) => {
            const hasCutoffs = run.cutoffStart && run.cutoffEnd;
            const periodDisplay = hasCutoffs
              ? `${format(new Date(run.cutoffStart), "MMM. dd, yyyy")} - ${format(
                  new Date(run.cutoffEnd),
                  "MMM. dd, yyyy"
                )}`
              : run.period;

            return (
              <TableRow key={run._id}>
                <TableCell>{periodDisplay}</TableCell>
                <TableCell>
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
                            <DropdownMenuItem onClick={() => onEdit(run)}>
                              <Pencil className="h-4 w-4 mr-2" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => onStatusChange(run, "finalized")}
                            >
                              <CheckCircle className="h-4 w-4 mr-2" />
                              Finalize
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
                            <DropdownMenuItem
                              onClick={() => onStatusChange(run, "draft")}
                            >
                              <Undo2 className="h-4 w-4 mr-2" />
                              Revert to Draft
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
                          Delete Payroll Run
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
