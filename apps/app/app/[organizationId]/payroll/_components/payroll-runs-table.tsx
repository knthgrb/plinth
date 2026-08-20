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
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Banknote,
  Archive,
  ArchiveRestore,
  Ban,
  CheckCircle,
  Eye,
  FileText,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Trash2,
  XCircle,
} from "lucide-react";
import { getStatusBadgeClass, getStatusBadgeStyle } from "@/utils/colors";

type PayrollRunDraftConfig = {
  employeeIds: string[];
  manualDeductions?: Array<{
    employeeId: string;
    deductions: Array<{ name: string; amount: number; type: string }>;
  }>;
  incentives?: Array<{
    employeeId: string;
    incentives: Array<{
      name: string;
      amount: number;
      type: string;
      taxable?: boolean;
    }>;
  }>;
  governmentDeductionSettings?: Array<{
    employeeId: string;
    sss: { enabled: boolean; frequency: "full" | "half" };
    pagibig: { enabled: boolean; frequency: "full" | "half" };
    philhealth: { enabled: boolean; frequency: "full" | "half" };
    tax: { enabled: boolean; frequency: "full" | "half" };
  }>;
  overrideReview?: {
    status: "needs_review" | "reviewed";
    employees: Array<{ fields: string[] }>;
  };
};

export type PayrollRunListItem = {
  _id: string;
  cutoffStart: number;
  cutoffEnd: number;
  period: string;
  runType?: "regular" | "13th_month" | "leave_conversion" | "final_pay";
  year?: number;
  status: string;
  processedAt?: number;
  archivedAt?: number;
  deductionsEnabled?: boolean;
  isDraftOutdated?: boolean;
  draftConfig?: PayrollRunDraftConfig;
};

interface PayrollRunsTableProps {
  payrollRuns: PayrollRunListItem[];
  isLoading?: boolean;
  selectedRunIds?: string[];
  onToggleRunSelection?: (runId: string, checked: boolean) => void;
  onToggleSelectAllVisible?: (runIds: string[], checked: boolean) => void;
  isDeletingRunId?: string | null;
  disableSelection?: boolean;
  onViewSummary: (run: PayrollRunListItem) => void;
  onViewPayslips: (run: PayrollRunListItem) => void;
  onEdit: (run: PayrollRunListItem) => void;
  onRegeneratePayslips?: (run: PayrollRunListItem) => void | Promise<void>;
  /** When set, shows spinner on that run's "Regenerate payslips" action */
  regeneratingPayrollRunId?: string | null;
  onStatusChange: (run: PayrollRunListItem, status: string) => void;
  onArchive?: (
    run: PayrollRunListItem,
    archived: boolean,
  ) => void | Promise<void>;
  onVoid?: (run: PayrollRunListItem) => void;
  onDelete: (run: PayrollRunListItem) => void;
  /** Pending payslip correction rows not yet sent in chat, keyed by payroll run id */
  pendingCorrectionByRunId?: Record<
    string,
    { pendingCorrections: number; uniquePayslips: number }
  >;
  onNotifyCorrections?: (run: PayrollRunListItem) => void | Promise<void>;
  /** When set, show spinner on that run's "Send corrected payslips" action */
  sendingCorrectionRunId?: string | null;
  /** Owner, admin, HR only — employees and accounting cannot delete runs */
  canDeletePayrollRuns?: boolean;
}

export function PayrollRunsTable({
  payrollRuns,
  isLoading = false,
  selectedRunIds = [],
  onToggleRunSelection,
  onToggleSelectAllVisible,
  isDeletingRunId = null,
  disableSelection = false,
  onViewSummary,
  onViewPayslips,
  onEdit,
  onRegeneratePayslips,
  regeneratingPayrollRunId = null,
  onStatusChange,
  onArchive,
  onVoid,
  onDelete,
  pendingCorrectionByRunId = {},
  onNotifyCorrections,
  sendingCorrectionRunId = null,
  canDeletePayrollRuns = true,
}: PayrollRunsTableProps) {
  const deletableVisibleRunIds = payrollRuns
    .filter((run) => run.status === "draft")
    .map((r) => String(r._id));
  const allDeletableSelected =
    deletableVisibleRunIds.length > 0 &&
    deletableVisibleRunIds.every((id) => selectedRunIds.includes(id));

  const colSpan = canDeletePayrollRuns ? 5 : 4;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {canDeletePayrollRuns && (
            <TableHead className="w-10">
              <Checkbox
                checked={allDeletableSelected}
                disabled={
                  disableSelection ||
                  deletableVisibleRunIds.length === 0 ||
                  !onToggleSelectAllVisible
                }
                onCheckedChange={(checked) => {
                  if (!onToggleSelectAllVisible) return;
                  onToggleSelectAllVisible(
                    deletableVisibleRunIds,
                    checked === true,
                  );
                }}
                aria-label="Select all deletable draft payroll runs"
              />
            </TableHead>
          )}
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
              {canDeletePayrollRuns && (
                <TableCell>
                  <div className="h-4 w-4 rounded bg-gray-200 animate-pulse" />
                </TableCell>
              )}
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
            <TableCell colSpan={colSpan} className="text-center text-gray-500">
              No payroll runs found
            </TableCell>
          </TableRow>
        ) : (
          payrollRuns?.map((run) => {
            const is13thMonth = (run.runType ?? "regular") === "13th_month";
            const hasCutoffs = run.cutoffStart && run.cutoffEnd;
            const needsOverrideReview =
              run.status === "draft" &&
              run.draftConfig?.overrideReview?.status === "needs_review";
            const periodDisplay = is13thMonth
              ? run.period || `13th Month Pay ${run.year ?? ""}`
              : hasCutoffs
                ? `${format(new Date(run.cutoffStart), "MMM. dd, yyyy")} - ${format(
                    new Date(run.cutoffEnd),
                    "MMM. dd, yyyy",
                  )}`
                : run.period;

            const canSelectForDelete = run.status === "draft";
            return (
              <TableRow key={run._id}>
                {canDeletePayrollRuns && (
                  <TableCell>
                    <Checkbox
                      checked={selectedRunIds.includes(String(run._id))}
                      disabled={disableSelection || !canSelectForDelete}
                      onCheckedChange={(checked) =>
                        onToggleRunSelection?.(
                          String(run._id),
                          checked === true,
                        )
                      }
                      aria-label={`Select payroll run ${periodDisplay}`}
                    />
                  </TableCell>
                )}
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
                    {run.archivedAt && run.status !== "archived" && (
                      <Badge variant="outline">Archived</Badge>
                    )}
                    {run.status === "draft" && run.isDraftOutdated && (
                      <Badge
                        variant="secondary"
                        className="bg-amber-100 text-amber-700 border border-amber-200"
                      >
                        Outdated
                      </Badge>
                    )}
                    {needsOverrideReview && (
                      <Badge
                        variant="secondary"
                        className="bg-orange-100 text-orange-700 border border-orange-200"
                      >
                        Needs override review
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
                        {run.status === "draft" && !run.archivedAt && (
                          <>
                            {(run.runType ?? "regular") !== "13th_month" && (
                              <>
                                <DropdownMenuItem onClick={() => onEdit(run)}>
                                  <Pencil className="h-4 w-4 mr-2" />
                                  Edit
                                </DropdownMenuItem>
                                {onRegeneratePayslips &&
                                  run.isDraftOutdated && (
                                    <DropdownMenuItem
                                      disabled={!!regeneratingPayrollRunId}
                                      onClick={() =>
                                        void onRegeneratePayslips(run)
                                      }
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
                              disabled={
                                run.isDraftOutdated || needsOverrideReview
                              }
                              onClick={() => onStatusChange(run, "finalized")}
                            >
                              <CheckCircle className="h-4 w-4 mr-2" />
                              {run.isDraftOutdated
                                ? "Finalize (regenerate required)"
                                : needsOverrideReview
                                  ? "Finalize (review overrides first)"
                                  : "Finalize"}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => onStatusChange(run, "cancelled")}
                            >
                              <XCircle className="h-4 w-4 mr-2" />
                              Cancel and retain
                            </DropdownMenuItem>
                          </>
                        )}
                        {run.status === "finalized" && !run.archivedAt && (
                          <>
                            {onNotifyCorrections &&
                              (pendingCorrectionByRunId[String(run._id)]
                                ?.pendingCorrections ?? 0) > 0 && (
                                <DropdownMenuItem
                                  disabled={!!sendingCorrectionRunId}
                                  onClick={() => void onNotifyCorrections(run)}
                                >
                                  {sendingCorrectionRunId === run._id ? (
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin shrink-0" />
                                  ) : (
                                    <MessageSquare className="h-4 w-4 mr-2" />
                                  )}
                                  {sendingCorrectionRunId === run._id
                                    ? "Sending…"
                                    : `Send corrected payslips (${pendingCorrectionByRunId[String(run._id)]?.uniquePayslips ?? 0})`}
                                </DropdownMenuItem>
                              )}
                            <DropdownMenuItem
                              onClick={() => onStatusChange(run, "paid")}
                            >
                              <Banknote className="h-4 w-4 mr-2" />
                              Mark as Paid
                            </DropdownMenuItem>
                            {onVoid && (
                              <DropdownMenuItem onClick={() => onVoid(run)}>
                                <Ban className="h-4 w-4 mr-2" />
                                Void payroll
                              </DropdownMenuItem>
                            )}
                          </>
                        )}
                        {run.status === "paid" && !run.archivedAt && (
                          <>
                            {onNotifyCorrections &&
                              (pendingCorrectionByRunId[String(run._id)]
                                ?.pendingCorrections ?? 0) > 0 && (
                                <DropdownMenuItem
                                  disabled={!!sendingCorrectionRunId}
                                  onClick={() => void onNotifyCorrections(run)}
                                >
                                  {sendingCorrectionRunId === run._id ? (
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin shrink-0" />
                                  ) : (
                                    <MessageSquare className="h-4 w-4 mr-2" />
                                  )}
                                  {sendingCorrectionRunId === run._id
                                    ? "Sending…"
                                    : `Send corrected payslips (${pendingCorrectionByRunId[String(run._id)]?.uniquePayslips ?? 0})`}
                                </DropdownMenuItem>
                              )}
                            {onVoid && (
                              <DropdownMenuItem onClick={() => onVoid(run)}>
                                <Ban className="h-4 w-4 mr-2" />
                                Void payroll
                              </DropdownMenuItem>
                            )}
                          </>
                        )}
                        {onArchive &&
                          !["draft", "processing", "archived"].includes(
                            run.status,
                          ) && (
                            <DropdownMenuItem
                              onClick={() =>
                                void onArchive(run, !Boolean(run.archivedAt))
                              }
                            >
                              {run.archivedAt ? (
                                <ArchiveRestore className="h-4 w-4 mr-2" />
                              ) : (
                                <Archive className="h-4 w-4 mr-2" />
                              )}
                              {run.archivedAt ? "Unarchive" : "Archive"}
                            </DropdownMenuItem>
                          )}
                        <DropdownMenuSeparator />
                        {canSelectForDelete && canDeletePayrollRuns && (
                          <DropdownMenuItem
                            disabled={
                              disableSelection || isDeletingRunId === run._id
                            }
                            onClick={(e) => {
                              e.stopPropagation();
                              onDelete(run);
                            }}
                            className="text-red-600"
                          >
                            {isDeletingRunId === run._id ? (
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4 mr-2" />
                            )}
                            {isDeletingRunId === run._id
                              ? "Deleting..."
                              : "Delete run"}
                          </DropdownMenuItem>
                        )}
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
