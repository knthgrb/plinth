"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { format } from "date-fns";
import {
  CalendarCheck,
  CalendarClock,
  CircleAlert,
  ClipboardCheck,
  History,
  Plus,
  Search,
  ShieldCheck,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MainLayout } from "@/components/layout/main-layout";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useOrganization } from "@/hooks/organization-context";
import type {
  EvaluationRecord,
  EvaluationWorkspaceEmployee,
} from "@/lib/evaluations/types";
import {
  DEFAULT_EVALUATION_EMPLOYMENT_STATUS_FILTER,
  filterEvaluationEmployees,
  paginateEvaluationEmployees,
  type EvaluationEmploymentStatusFilter,
  type EvaluationEmployeeListItem,
  type EvaluationTimingFilter,
} from "@/lib/evaluations/view";
import {
  getEvaluationTiming,
  type EvaluationTiming,
} from "@/lib/evaluations/workflow";
import {
  EvaluationEditorDialog,
  type EvaluationEditorMode,
} from "./evaluation-editor-dialog";
import { EvaluationHistoryDialog } from "./evaluation-history-dialog";

type EmployeeViewRow = EvaluationEmployeeListItem & {
  source: EvaluationWorkspaceEmployee;
};

type EditorState = {
  open: boolean;
  mode: EvaluationEditorMode;
  employeeId?: string;
  evaluation?: EvaluationRecord;
};

const PAGE_SIZE = 20;

const timingLabels: Record<EvaluationTiming, string> = {
  scheduled: "Scheduled",
  due_soon: "Due soon",
  overdue: "Overdue",
  completed: "Completed",
  cancelled: "Cancelled",
};

function timingBadgeClass(timing: EvaluationTiming): string {
  if (timing === "overdue") return "border-red-200 bg-red-50 text-red-700";
  if (timing === "due_soon")
    return "border-amber-200 bg-amber-50 text-amber-700";
  if (timing === "completed")
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (timing === "cancelled")
    return "border-gray-200 bg-gray-100 text-gray-600";
  return "border-indigo-200 bg-indigo-50 text-indigo-700";
}

function cadenceLabel(row: EvaluationWorkspaceEmployee): string {
  const activeSchedule = row.schedules.find((schedule) => schedule.isActive);
  const schedule = activeSchedule ?? row.schedules[0];
  if (!schedule) return "Ad hoc";
  if (!schedule.isActive) return "Paused";
  if (schedule.cadenceKind === "custom") {
    return `Every ${schedule.intervalMonths} month${schedule.intervalMonths === 1 ? "" : "s"}`;
  }
  if (schedule.cadenceKind === "quarterly") return "Quarterly";
  if (schedule.cadenceKind === "semiannual") return "Every 6 months";
  return "Annual";
}

export function EvaluationsContent() {
  const { currentOrganizationId } = useOrganization();
  const user = useQuery(api.organizations.getCurrentUser, {
    organizationId: currentOrganizationId || undefined,
  });
  const canManageEvaluations =
    user?.role === "owner" || user?.role === "admin" || user?.role === "hr";
  const workspace = useQuery(
    api.evaluations.getEvaluationWorkspace,
    currentOrganizationId && canManageEvaluations
      ? { organizationId: currentOrganizationId }
      : "skip",
  );

  const [search, setSearch] = useState("");
  const [referenceNow] = useState(Date.now);
  const [department, setDepartment] = useState("all");
  const [employmentStatus, setEmploymentStatus] =
    useState<EvaluationEmploymentStatusFilter>(
      DEFAULT_EVALUATION_EMPLOYMENT_STATUS_FILTER,
    );
  const [timing, setTiming] = useState<EvaluationTimingFilter>("all");
  const [page, setPage] = useState(1);
  const [historyEmployee, setHistoryEmployee] =
    useState<EvaluationWorkspaceEmployee | null>(null);
  const [editor, setEditor] = useState<EditorState>({
    open: false,
    mode: "schedule",
  });

  const employeeRows = useMemo<EmployeeViewRow[]>(
    () =>
      (workspace?.employees ?? []).map((row) => ({
        id: row.employee._id,
        name: `${row.employee.firstName} ${row.employee.lastName}`,
        employeeCode: row.employee.employeeCode,
        position: row.employee.position,
        department: row.employee.department,
        employmentStatus: row.employee.employmentStatus,
        nextEvaluation: row.nextEvaluation
          ? {
              status: row.nextEvaluation.status,
              scheduledFor: row.nextEvaluation.scheduledFor,
            }
          : null,
        hasCompleted: row.lastCompleted !== undefined,
        source: row,
      })),
    [workspace],
  );
  const departments = useMemo(
    () =>
      Array.from(new Set(employeeRows.map((row) => row.department)))
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right)),
    [employeeRows],
  );
  const filteredRows = useMemo(
    () =>
      filterEvaluationEmployees(employeeRows, {
        search,
        department,
        employmentStatus,
        timing,
        now: referenceNow,
      }),
    [department, employeeRows, employmentStatus, referenceNow, search, timing],
  );
  const pagination = useMemo(
    () => paginateEvaluationEmployees(filteredRows, page, PAGE_SIZE),
    [filteredRows, page],
  );

  const openSchedule = (employeeId?: string) => {
    setHistoryEmployee(null);
    setEditor({ open: true, mode: "schedule", employeeId });
  };
  const openExisting = (
    mode: "reschedule" | "complete",
    evaluation: EvaluationRecord,
  ) => {
    setHistoryEmployee(null);
    setEditor({
      open: true,
      mode,
      employeeId: evaluation.employeeId,
      evaluation,
    });
  };

  if (!currentOrganizationId) {
    return (
      <MainLayout>
        <div className="p-8">No organization selected.</div>
      </MainLayout>
    );
  }

  if (user !== undefined && !canManageEvaluations) {
    return (
      <MainLayout>
        <div className="mx-auto max-w-xl p-8 text-center">
          <ShieldCheck className="mx-auto h-10 w-10 text-[rgb(130,130,130)]" />
          <h1 className="mt-4 text-xl font-semibold">
            Private evaluation records
          </h1>
          <p className="mt-2 text-sm text-[rgb(110,110,110)]">
            Evaluations are available only to Owner, Admin, and HR roles.
          </p>
        </div>
      </MainLayout>
    );
  }

  const isLoading = user === undefined || workspace === undefined;

  return (
    <MainLayout>
      <div className="space-y-5 p-3 sm:p-4 md:p-6 lg:p-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">
              Evaluations
            </h1>
            <p className="mt-1 text-sm text-[rgb(105,105,105)]">
              Schedule employee-specific reviews, track due dates, and retain
              locked records.
            </p>
          </div>
          <Button onClick={() => openSchedule()}>
            <Plus className="mr-1.5 h-4 w-4" /> Schedule evaluation
          </Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            {
              label: "Overdue",
              value: workspace?.summary.overdue ?? 0,
              icon: CircleAlert,
            },
            {
              label: "Due in 14 days",
              value: workspace?.summary.dueSoon ?? 0,
              icon: CalendarClock,
            },
            {
              label: "Scheduled later",
              value: workspace?.summary.scheduled ?? 0,
              icon: CalendarCheck,
            },
            {
              label: "Completed records",
              value: workspace?.summary.completed ?? 0,
              icon: ClipboardCheck,
            },
          ].map((item) => (
            <Card key={item.label}>
              <CardContent className="flex items-center justify-between p-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-[rgb(120,120,120)]">
                    {item.label}
                  </p>
                  <p className="mt-1 text-2xl font-bold text-[rgb(48,48,48)]">
                    {isLoading ? "—" : item.value}
                  </p>
                </div>
                <div className="rounded-xl bg-brand-purple/10 p-2.5 text-brand-purple">
                  <item.icon className="h-5 w-5" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <div className="flex flex-col gap-3 border-b border-[#E6E6E6] p-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative w-full lg:max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[rgb(130,130,130)]" />
              <Input
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder="Search employee, ID, position, or department"
                className="pl-9"
              />
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Select
                value={department}
                onValueChange={(value) => {
                  setDepartment(value);
                  setPage(1);
                }}
              >
                <SelectTrigger className="w-full sm:w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All departments</SelectItem>
                  {departments.map((item) => (
                    <SelectItem key={item} value={item}>
                      {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={employmentStatus}
                onValueChange={(value) => {
                  setEmploymentStatus(
                    value as EvaluationEmploymentStatusFilter,
                  );
                  setPage(1);
                }}
              >
                <SelectTrigger className="w-full sm:w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active employees</SelectItem>
                  <SelectItem value="all">All employees</SelectItem>
                  <SelectItem value="separated">Separated</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={timing}
                onValueChange={(value) => {
                  setTiming(value as EvaluationTimingFilter);
                  setPage(1);
                }}
              >
                <SelectTrigger className="w-full sm:w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All evaluation statuses</SelectItem>
                  <SelectItem value="overdue">Overdue</SelectItem>
                  <SelectItem value="due_soon">Due soon</SelectItem>
                  <SelectItem value="scheduled">Scheduled later</SelectItem>
                  <SelectItem value="completed">
                    Has completed records
                  </SelectItem>
                  <SelectItem value="not_scheduled">Not scheduled</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Position</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Cadence</TableHead>
                  <TableHead>Last completed</TableHead>
                  <TableHead>Next due</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading
                  ? Array.from({ length: 8 }, (_, index) => (
                      <TableRow key={index}>
                        {Array.from({ length: 8 }, (_, cell) => (
                          <TableCell key={cell}>
                            <div className="h-4 w-24 animate-pulse rounded bg-[rgb(235,235,235)]" />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  : pagination.items.map((row) => {
                      const next = row.source.nextEvaluation;
                      const timingValue = next
                        ? getEvaluationTiming(
                            next.status,
                            next.scheduledFor,
                            referenceNow,
                          )
                        : null;
                      return (
                        <TableRow
                          key={row.id}
                          className="hover:bg-[rgb(250,250,250)]"
                        >
                          <TableCell>
                            <button
                              type="button"
                              className="text-left"
                              onClick={() => setHistoryEmployee(row.source)}
                            >
                              <span className="block font-semibold text-[rgb(48,48,48)]">
                                {row.name}
                              </span>
                              <span className="text-xs text-[rgb(120,120,120)]">
                                {row.employeeCode}
                              </span>
                            </button>
                          </TableCell>
                          <TableCell>{row.position}</TableCell>
                          <TableCell>{row.department}</TableCell>
                          <TableCell>{cadenceLabel(row.source)}</TableCell>
                          <TableCell>
                            {row.source.lastCompleted?.completedAt
                              ? format(
                                  new Date(
                                    row.source.lastCompleted.completedAt,
                                  ),
                                  "MMM d, yyyy",
                                )
                              : "—"}
                          </TableCell>
                          <TableCell>
                            {next
                              ? format(
                                  new Date(next.scheduledFor),
                                  "MMM d, yyyy",
                                )
                              : "—"}
                          </TableCell>
                          <TableCell>
                            {timingValue ? (
                              <Badge
                                variant="outline"
                                className={timingBadgeClass(timingValue)}
                              >
                                {timingLabels[timingValue]}
                              </Badge>
                            ) : (
                              <Badge variant="secondary">Not scheduled</Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex justify-end gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => setHistoryEmployee(row.source)}
                              >
                                <History className="mr-1.5 h-3.5 w-3.5" />{" "}
                                History
                              </Button>
                              {next ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  onClick={() => openExisting("complete", next)}
                                >
                                  Complete
                                </Button>
                              ) : (
                                <Button
                                  type="button"
                                  size="sm"
                                  onClick={() => openSchedule(row.id)}
                                >
                                  Schedule
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                {!isLoading && pagination.items.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={8}
                      className="py-10 text-center text-[rgb(110,110,110)]"
                    >
                      No employees match these filters.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </CardContent>

          {!isLoading ? (
            <div className="flex flex-col items-center justify-between gap-3 border-t border-[#E6E6E6] px-4 py-3 text-sm text-[rgb(100,100,100)] sm:flex-row">
              <span>
                Showing{" "}
                {pagination.totalItems === 0 ? 0 : pagination.startIndex + 1}–
                {pagination.endIndex} of {pagination.totalItems} employees
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pagination.page <= 1}
                  onClick={() => setPage(pagination.page - 1)}
                >
                  Previous
                </Button>
                <span className="min-w-24 text-center">
                  Page {pagination.page} of {pagination.totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pagination.page >= pagination.totalPages}
                  onClick={() => setPage(pagination.page + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          ) : null}
        </Card>
      </div>

      {workspace ? (
        <>
          <EvaluationHistoryDialog
            open={historyEmployee !== null}
            onOpenChange={(open) => {
              if (!open) setHistoryEmployee(null);
            }}
            employeeRow={historyEmployee}
            evaluations={workspace.evaluations}
            onSchedule={openSchedule}
            onEdit={(evaluation) => openExisting("reschedule", evaluation)}
            onComplete={(evaluation) => openExisting("complete", evaluation)}
          />
          <EvaluationEditorDialog
            open={editor.open}
            onOpenChange={(open) =>
              setEditor((current) => ({ ...current, open }))
            }
            mode={editor.mode}
            organizationId={currentOrganizationId}
            workspace={workspace}
            employeeId={editor.employeeId}
            evaluation={editor.evaluation}
          />
        </>
      ) : null}
    </MainLayout>
  );
}
