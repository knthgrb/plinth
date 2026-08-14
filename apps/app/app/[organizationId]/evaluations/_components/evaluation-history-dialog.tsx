"use client";

import { useMemo, useState } from "react";
import {
  cancelEvaluation,
  setEvaluationScheduleActive,
} from "@/actions/evaluations";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import type {
  EvaluationRecord,
  EvaluationWorkspaceEmployee,
} from "@/lib/evaluations/types";
import { getEvaluationTiming, type EvaluationTiming } from "@/lib/evaluations/workflow";
import { format } from "date-fns";
import { CalendarPlus, Pause, Pencil, Play, ShieldCheck } from "lucide-react";
import { EvaluationAttachmentList } from "./evaluation-attachment-list";

type EvaluationHistoryDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employeeRow: EvaluationWorkspaceEmployee | null;
  evaluations: EvaluationRecord[];
  onSchedule: (employeeId: string) => void;
  onEdit: (evaluation: EvaluationRecord) => void;
  onComplete: (evaluation: EvaluationRecord) => void;
};

const timingLabels: Record<EvaluationTiming, string> = {
  scheduled: "Scheduled",
  due_soon: "Due soon",
  overdue: "Overdue",
  completed: "Completed",
  cancelled: "Cancelled",
};

function timingClass(timing: EvaluationTiming): string {
  if (timing === "overdue") return "border-red-200 bg-red-50 text-red-700";
  if (timing === "due_soon") return "border-amber-200 bg-amber-50 text-amber-700";
  if (timing === "completed") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (timing === "cancelled") return "border-gray-200 bg-gray-100 text-gray-600";
  return "border-indigo-200 bg-indigo-50 text-indigo-700";
}

function outcomeLabel(outcome: EvaluationRecord["outcome"]): string | null {
  if (!outcome) return null;
  return outcome
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function EvaluationHistoryDialog({
  open,
  onOpenChange,
  employeeRow,
  evaluations,
  onSchedule,
  onEdit,
  onComplete,
}: EvaluationHistoryDialogProps) {
  const { toast } = useToast();
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [referenceNow] = useState(Date.now);
  const [cancelReason, setCancelReason] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);

  const history = useMemo(() => {
    if (!employeeRow) return [];
    return evaluations
      .filter((evaluation) => evaluation.employeeId === employeeRow.employee._id)
      .sort((left, right) => right.scheduledFor - left.scheduledFor);
  }, [employeeRow, evaluations]);

  if (!employeeRow) return null;

  const employeeName = `${employeeRow.employee.firstName} ${employeeRow.employee.lastName}`;

  const handleCancel = async () => {
    if (!cancelId || !cancelReason.trim()) return;
    try {
      setSavingId(cancelId);
      await cancelEvaluation(cancelId, cancelReason.trim());
      setCancelId(null);
      setCancelReason("");
      toast({ title: "Evaluation cancelled" });
    } catch (error: unknown) {
      toast({
        title: "Unable to cancel evaluation",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSavingId(null);
    }
  };

  const toggleSchedule = async (scheduleId: string, isActive: boolean) => {
    try {
      setSavingId(scheduleId);
      await setEvaluationScheduleActive(scheduleId, isActive);
      toast({
        title: isActive ? "Schedule resumed" : "Schedule paused",
      });
    } catch (error: unknown) {
      toast({
        title: "Unable to update schedule",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSavingId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <div className="flex flex-wrap items-start justify-between gap-3 pr-8">
            <div>
              <DialogTitle>{employeeName}</DialogTitle>
              <DialogDescription>
                {employeeRow.employee.position} · {employeeRow.employee.department} · {employeeRow.employee.employeeCode}
              </DialogDescription>
            </div>
            <Button size="sm" onClick={() => onSchedule(employeeRow.employee._id)}>
              <CalendarPlus className="mr-1.5 h-4 w-4" /> Schedule evaluation
            </Button>
          </div>
        </DialogHeader>

        {employeeRow.schedules.length ? (
          <div className="space-y-2 rounded-xl border border-[#E6E6E6] bg-[rgb(250,250,250)] p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-[rgb(110,110,110)]">Recurring schedules</p>
            {employeeRow.schedules.map((schedule) => (
              <div key={schedule._id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <div>
                  <span className="font-semibold">{schedule.title}</span>
                  <span className="ml-2 text-[rgb(110,110,110)]">
                    {schedule.cadenceKind === "custom"
                      ? `Every ${schedule.intervalMonths} month${schedule.intervalMonths === 1 ? "" : "s"}`
                      : schedule.cadenceKind}
                  </span>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={savingId === schedule._id}
                  onClick={() => void toggleSchedule(schedule._id, !schedule.isActive)}
                >
                  {schedule.isActive ? <Pause className="mr-1.5 h-3.5 w-3.5" /> : <Play className="mr-1.5 h-3.5 w-3.5" />}
                  {schedule.isActive ? "Pause" : "Resume"}
                </Button>
              </div>
            ))}
          </div>
        ) : null}

        <div className="space-y-3">
          {history.length ? (
            history.map((evaluation) => {
              const timing = getEvaluationTiming(
                evaluation.status,
                evaluation.scheduledFor,
                referenceNow,
              );
              const outcome = outcomeLabel(evaluation.outcome);
              return (
                <article key={evaluation._id} className="rounded-xl border border-[#E6E6E6] p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-[rgb(48,48,48)]">{evaluation.label}</h3>
                        <Badge variant="outline" className={timingClass(timing)}>
                          {timingLabels[timing]}
                        </Badge>
                      </div>
                      <p className="mt-1 text-sm text-[rgb(110,110,110)]">
                        Scheduled {format(new Date(evaluation.scheduledFor), "MMM d, yyyy")}
                        {evaluation.completedAt
                          ? ` · Completed ${format(new Date(evaluation.completedAt), "MMM d, yyyy")}`
                          : ""}
                      </p>
                    </div>
                    {evaluation.status === "scheduled" ? (
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" size="sm" onClick={() => onComplete(evaluation)}>
                          Complete
                        </Button>
                        <Button type="button" variant="outline" size="sm" onClick={() => onEdit(evaluation)}>
                          <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit
                        </Button>
                        <Button type="button" variant="outline" size="sm" onClick={() => setCancelId(evaluation._id)}>
                          Cancel
                        </Button>
                      </div>
                    ) : null}
                  </div>

                  {cancelId === evaluation._id ? (
                    <div className="mt-4 space-y-2 rounded-lg border border-red-100 bg-red-50 p-3">
                      <Label htmlFor={`cancel-${evaluation._id}`}>Cancellation reason</Label>
                      <Input
                        id={`cancel-${evaluation._id}`}
                        value={cancelReason}
                        onChange={(event) => setCancelReason(event.target.value)}
                        placeholder="Why is this occurrence being cancelled?"
                      />
                      <div className="flex gap-2">
                        <Button type="button" size="sm" variant="destructive" disabled={!cancelReason.trim() || savingId === evaluation._id} onClick={() => void handleCancel()}>
                          Confirm cancellation
                        </Button>
                        <Button type="button" size="sm" variant="outline" onClick={() => setCancelId(null)}>Keep evaluation</Button>
                      </div>
                    </div>
                  ) : null}

                  {evaluation.status === "completed" ? (
                    <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                      {evaluation.rating !== undefined ? (
                        <div><span className="text-[rgb(110,110,110)]">Rating</span><p className="font-semibold">{evaluation.rating}/5</p></div>
                      ) : null}
                      {outcome ? (
                        <div><span className="text-[rgb(110,110,110)]">Outcome</span><p className="font-semibold">{outcome}</p></div>
                      ) : null}
                      {evaluation.followUpDate ? (
                        <div><span className="text-[rgb(110,110,110)]">Follow-up</span><p className="font-semibold">{format(new Date(evaluation.followUpDate), "MMM d, yyyy")}</p></div>
                      ) : null}
                      {evaluation.notes ? (
                        <div className="sm:col-span-2"><span className="text-[rgb(110,110,110)]">Private notes</span><p className="mt-1 whitespace-pre-wrap">{evaluation.notes}</p></div>
                      ) : null}
                    </div>
                  ) : null}

                  {evaluation.cancellationReason ? (
                    <p className="mt-3 text-sm text-[rgb(100,100,100)]">Reason: {evaluation.cancellationReason}</p>
                  ) : null}

                  <div className="mt-4">
                    <EvaluationAttachmentList
                      evaluationId={evaluation._id}
                      attachmentIds={evaluation.attachmentIds.map(String)}
                    />
                  </div>
                  {evaluation.lockedAt ? (
                    <p className="mt-3 flex items-center gap-1.5 text-xs text-[rgb(110,110,110)]">
                      <ShieldCheck className="h-3.5 w-3.5" /> Locked record
                    </p>
                  ) : null}
                </article>
              );
            })
          ) : (
            <div className="rounded-xl border border-dashed border-[#D8D8D8] p-8 text-center">
              <p className="font-medium">No evaluation records yet</p>
              <p className="mt-1 text-sm text-[rgb(120,120,120)]">Schedule the employee&apos;s first evaluation when ready.</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
