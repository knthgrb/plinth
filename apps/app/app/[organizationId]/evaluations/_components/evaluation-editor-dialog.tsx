"use client";

import { useEffect, useState } from "react";
import {
  completeEvaluation,
  scheduleEvaluation,
  updateScheduledEvaluation,
} from "@/actions/evaluations";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import type {
  EvaluationOutcome,
  EvaluationRecord,
  EvaluationWorkspace,
} from "@/lib/evaluations/types";
import type { EvaluationCadence } from "@/lib/evaluations/workflow";
import { uploadFileToStorage } from "@/lib/storage-upload";
import { FileUp, LockKeyhole, X } from "lucide-react";

export type EvaluationEditorMode = "schedule" | "reschedule" | "complete";

type EvaluationEditorDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: EvaluationEditorMode;
  organizationId: string;
  workspace: EvaluationWorkspace;
  employeeId?: string;
  evaluation?: EvaluationRecord;
};

const OUTCOMES: Array<{ value: EvaluationOutcome; label: string }> = [
  { value: "exceeds_expectations", label: "Exceeds expectations" },
  { value: "meets_expectations", label: "Meets expectations" },
  { value: "partially_meets_expectations", label: "Partially meets expectations" },
  { value: "does_not_meet_expectations", label: "Does not meet expectations" },
];

function toDateInput(timestamp: number | undefined): string {
  return timestamp ? new Date(timestamp).toISOString().slice(0, 10) : "";
}

function dateInputToTimestamp(value: string): number {
  return Date.parse(`${value}T00:00:00.000Z`);
}

function cadenceFromValue(value: string, intervalMonths: number): EvaluationCadence {
  if (value === "quarterly" || value === "semiannual" || value === "annual") {
    return { kind: value };
  }
  if (value === "custom") return { kind: "custom", intervalMonths };
  return { kind: "none" };
}

export function EvaluationEditorDialog({
  open,
  onOpenChange,
  mode,
  organizationId,
  workspace,
  employeeId,
  evaluation,
}: EvaluationEditorDialogProps) {
  const { toast } = useToast();
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [title, setTitle] = useState("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [completedDate, setCompletedDate] = useState("");
  const [templateId, setTemplateId] = useState("none");
  const [cadenceKind, setCadenceKind] = useState("none");
  const [intervalMonths, setIntervalMonths] = useState(1);
  const [reviewerIds, setReviewerIds] = useState<string[]>([]);
  const [rating, setRating] = useState("");
  const [outcome, setOutcome] = useState<EvaluationOutcome | "none">("none");
  const [notes, setNotes] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelectedEmployeeId(employeeId ?? evaluation?.employeeId ?? "");
    setTitle(evaluation?.label ?? "");
    setScheduledDate(toDateInput(evaluation?.scheduledFor));
    setCompletedDate(toDateInput(Date.now()));
    setTemplateId(evaluation?.templateId ?? "none");
    setReviewerIds(evaluation?.assignedReviewerIds.map(String) ?? []);
    setCadenceKind("none");
    setIntervalMonths(1);
    setRating(evaluation?.rating !== undefined ? String(evaluation.rating) : "");
    setOutcome(evaluation?.outcome ?? "none");
    setNotes(evaluation?.notes ?? "");
    setFollowUpDate(toDateInput(evaluation?.followUpDate));
    setFiles([]);
  }, [employeeId, evaluation, open]);

  const toggleReviewer = (reviewerId: string, checked: boolean) => {
    setReviewerIds((current) =>
      checked
        ? Array.from(new Set([...current, reviewerId]))
        : current.filter((id) => id !== reviewerId),
    );
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      setIsSaving(true);
      if (mode === "complete") {
        if (!evaluation || !completedDate) return;
        const uploadedIds: string[] = [];
        for (const file of files) {
          uploadedIds.push(
            await uploadFileToStorage({
              organizationId,
              purpose: "evaluation_attachment",
              file,
            }),
          );
        }
        await completeEvaluation({
          evaluationId: evaluation._id,
          completedAt: dateInputToTimestamp(completedDate),
          rating: rating ? Number(rating) : undefined,
          outcome: outcome === "none" ? undefined : outcome,
          notes: notes.trim() || undefined,
          followUpDate: followUpDate
            ? dateInputToTimestamp(followUpDate)
            : undefined,
          attachmentIds: [
            ...evaluation.attachmentIds.map(String),
            ...uploadedIds,
          ],
        });
        toast({
          title: "Evaluation completed",
          description: "The final record is locked and retained in history.",
        });
      } else if (mode === "reschedule") {
        if (!evaluation || !scheduledDate || !title.trim()) return;
        await updateScheduledEvaluation({
          evaluationId: evaluation._id,
          title: title.trim(),
          scheduledFor: dateInputToTimestamp(scheduledDate),
          templateId: templateId === "none" ? undefined : templateId,
          reviewerIds,
        });
        toast({
          title: "Evaluation updated",
          description: "The scheduled review details were updated.",
        });
      } else {
        if (!selectedEmployeeId || !scheduledDate || !title.trim()) return;
        await scheduleEvaluation({
          organizationId,
          employeeId: selectedEmployeeId,
          title: title.trim(),
          scheduledFor: dateInputToTimestamp(scheduledDate),
          templateId: templateId === "none" ? undefined : templateId,
          cadence: cadenceFromValue(cadenceKind, intervalMonths),
          reviewerIds,
        });
        toast({
          title: "Evaluation scheduled",
          description:
            cadenceKind === "none"
              ? "The one-time evaluation was added."
              : "The first evaluation and recurring schedule were added.",
        });
      }
      onOpenChange(false);
    } catch (error: unknown) {
      toast({
        title: "Unable to save evaluation",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const dialogTitle =
    mode === "complete"
      ? "Complete evaluation"
      : mode === "reschedule"
        ? "Edit scheduled evaluation"
        : "Schedule evaluation";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription>
            This record is private to Owner, Admin, and HR roles.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-5" onSubmit={handleSubmit}>
          {mode === "schedule" ? (
            <div className="space-y-2">
              <Label>Employee</Label>
              <Select value={selectedEmployeeId} onValueChange={setSelectedEmployeeId}>
                <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                <SelectContent>
                  {workspace.employees.map(({ employee }) => (
                    <SelectItem key={employee._id} value={employee._id}>
                      {employee.firstName} {employee.lastName} · {employee.employeeCode}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {mode !== "complete" ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Evaluation title</Label>
                  <Input
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="Annual performance review"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>Scheduled date</Label>
                  <Input
                    type="date"
                    value={scheduledDate}
                    onChange={(event) => setScheduledDate(event.target.value)}
                    required
                  />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Template</Label>
                  <Select value={templateId} onValueChange={setTemplateId}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No template</SelectItem>
                      {workspace.templates.map((template) => (
                        <SelectItem key={template._id} value={template._id}>
                          {template.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {mode === "schedule" ? (
                  <div className="space-y-2">
                    <Label>Repeat</Label>
                    <Select value={cadenceKind} onValueChange={setCadenceKind}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">One time</SelectItem>
                        <SelectItem value="quarterly">Every 3 months</SelectItem>
                        <SelectItem value="semiannual">Every 6 months</SelectItem>
                        <SelectItem value="annual">Every 12 months</SelectItem>
                        <SelectItem value="custom">Custom interval</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
              </div>
              {mode === "schedule" && cadenceKind === "custom" ? (
                <div className="space-y-2">
                  <Label>Repeat every (months)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={60}
                    value={intervalMonths}
                    onChange={(event) => setIntervalMonths(Number(event.target.value))}
                    required
                  />
                </div>
              ) : null}
              <div className="space-y-2">
                <Label>Evaluators</Label>
                <div className="max-h-36 space-y-2 overflow-y-auto rounded-lg border border-[#DDDDDD] p-3">
                  {workspace.reviewers.length ? (
                    workspace.reviewers.map((reviewer) => (
                      <label key={reviewer._id} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={reviewerIds.includes(reviewer._id)}
                          onCheckedChange={(checked) =>
                            toggleReviewer(reviewer._id, checked === true)
                          }
                        />
                        <span>{reviewer.name ?? reviewer.email}</span>
                      </label>
                    ))
                  ) : (
                    <p className="text-sm text-[rgb(133,133,133)]">No eligible evaluators found.</p>
                  )}
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="rounded-lg border border-[#E5E1FF] bg-[#F7F5FF] p-3 text-sm text-[#4F46A5]">
                <div className="flex items-center gap-2 font-semibold">
                  <LockKeyhole className="h-4 w-4" /> Final records are locked
                </div>
                <p className="mt-1 text-xs">Verify the details before completing this evaluation.</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Actual completion date</Label>
                  <Input
                    type="date"
                    value={completedDate}
                    onChange={(event) => setCompletedDate(event.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>Overall rating (optional)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={5}
                    step={0.5}
                    value={rating}
                    onChange={(event) => setRating(event.target.value)}
                    placeholder="1–5"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Outcome</Label>
                <Select
                  value={outcome}
                  onValueChange={(value) => setOutcome(value as EvaluationOutcome | "none")}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No outcome selected</SelectItem>
                    {OUTCOMES.map((item) => (
                      <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Private evaluation notes</Label>
                <Textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Performance summary, development needs, and agreed actions"
                  rows={5}
                />
              </div>
              <div className="space-y-2">
                <Label>Follow-up date (optional)</Label>
                <Input
                  type="date"
                  value={followUpDate}
                  onChange={(event) => setFollowUpDate(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="evaluation-files">Forms and supporting files</Label>
                <label
                  htmlFor="evaluation-files"
                  className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-[#CFCFCF] px-4 py-5 text-sm font-medium text-[rgb(90,90,90)] hover:bg-[rgb(250,250,250)]"
                >
                  <FileUp className="h-4 w-4" /> Add files
                </label>
                <Input
                  id="evaluation-files"
                  type="file"
                  multiple
                  className="sr-only"
                  onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
                />
                {files.map((file, index) => (
                  <div key={`${file.name}-${index}`} className="flex items-center justify-between rounded-md bg-[rgb(247,247,247)] px-3 py-2 text-sm">
                    <span className="truncate">{file.name}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${file.name}`}
                      onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving
                ? "Saving…"
                : mode === "complete"
                  ? "Complete and lock"
                  : mode === "reschedule"
                    ? "Save changes"
                    : "Schedule evaluation"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
