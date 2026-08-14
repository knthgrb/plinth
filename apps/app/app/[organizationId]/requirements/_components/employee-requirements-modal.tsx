"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { format } from "date-fns";
import { api } from "@/convex/_generated/api";
import {
  removeRequirement,
  updateRequirementFile,
  updateRequirementStatus,
} from "@/actions/employees";
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
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { uploadFileToStorage } from "@/lib/storage-upload";
import {
  deriveRequirementState,
  type RequirementPolicy,
  type RequirementState,
} from "@/lib/requirements/workflow";
import {
  errorMessage,
  getApplicableEmployeeRequirements,
  getHistoricalEmployeeRequirements,
  type RequirementsEmployee,
} from "@/lib/requirements/ui-types";
import {
  CheckCircle2,
  Eye,
  FileWarning,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react";
import { AddRequirementDialog } from "./add-requirement-dialog";

interface EmployeeRequirementsModalProps {
  employee: RequirementsEmployee;
  policies: readonly RequirementPolicy[];
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  onPreviewFile: (storageId: string, requirementType: string) => Promise<void>;
}

const stateCopy: Record<RequirementState, string> = {
  missing: "Missing",
  awaiting_review: "Awaiting review",
  rejected: "Rejected",
  expiring: "Expiring",
  expired: "Expired",
  complete: "Complete",
  optional: "Optional",
};

function stateVariant(
  state: RequirementState,
): "default" | "secondary" | "destructive" | "outline" {
  if (state === "complete") return "default";
  if (state === "expired" || state === "rejected") return "destructive";
  if (state === "optional") return "outline";
  return "secondary";
}

export function EmployeeRequirementsModal({
  employee,
  policies,
  isOpen,
  onOpenChange,
  organizationId,
  onPreviewFile,
}: EmployeeRequirementsModalProps) {
  const { toast } = useToast();
  const [busyIndex, setBusyIndex] = useState<number | null>(null);
  const [reviewNotes, setReviewNotes] = useState<Record<number, string>>({});
  const [rejectionReasons, setRejectionReasons] = useState<
    Record<number, string>
  >({});
  const requirementEvents = useQuery(
    api.employees.getEmployeeRequirementEvents,
    isOpen ? { employeeId: employee._id } : "skip",
  );
  const requirements = getApplicableEmployeeRequirements(employee, policies);
  const historicalRequirements = getHistoricalEmployeeRequirements(
    employee,
    policies,
  );
  const employeeName =
    `${employee.personalInfo.firstName} ${employee.personalInfo.lastName}`.trim();

  async function perform(
    index: number,
    operation: () => Promise<unknown>,
    success: string,
  ) {
    setBusyIndex(index);
    try {
      await operation();
      toast({ title: success });
    } catch (error: unknown) {
      toast({
        title: "Unable to update requirement",
        description: errorMessage(error, "Please try again."),
        variant: "destructive",
      });
    } finally {
      setBusyIndex(null);
    }
  }

  function uploadEvidence(index: number, requirementId: string, file: File) {
    if (file.size > 10 * 1024 * 1024) {
      toast({
        title: "Files must be 10 MB or smaller",
        variant: "destructive",
      });
      return;
    }
    return perform(
      index,
      async () => {
        const storageId = await uploadFileToStorage({
          organizationId,
          purpose: "employee_requirement",
          file,
        });
        await updateRequirementFile({
          employeeId: employee._id,
          requirementId,
          file: storageId,
        });
      },
      "Evidence submitted",
    );
  }

  function verify(index: number, requirementId: string) {
    return perform(
      index,
      () =>
        updateRequirementStatus({
          employeeId: employee._id,
          requirementId,
          status: "verified",
          verificationNotes: reviewNotes[index]?.trim() || undefined,
        }),
      "Requirement verified",
    );
  }

  function reject(index: number, requirementId: string) {
    return perform(
      index,
      () =>
        updateRequirementStatus({
          employeeId: employee._id,
          requirementId,
          status: "pending",
          rejectionReason: rejectionReasons[index],
        }),
      "Submission returned to employee",
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{employeeName}</DialogTitle>
          <DialogDescription>
            Review evidence, return problems with context, and track renewals.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-between rounded-xl bg-[#F7F6FA] p-3">
          <div>
            <p className="text-sm font-medium">
              {employee.employment.position}
            </p>
            <p className="text-xs text-[#77727F]">
              {employee.employment.department} ·{" "}
              {employee.employment.employmentType}
            </p>
          </div>
          <AddRequirementDialog
            employeeId={employee._id}
            onSuccess={() => undefined}
          />
        </div>
        <div className="space-y-3">
          {requirements.length === 0 ? (
            <div className="rounded-xl border border-dashed p-10 text-center text-sm text-[#928C99]">
              No requirements apply to this employee.
            </div>
          ) : (
            requirements.map(({ requirement, index }) => {
              const derived = deriveRequirementState(requirement);
              const auditEvents = (requirementEvents ?? []).filter(
                (event) => event.requirementId === requirement.requirementId,
              );
              return (
                <section
                  key={requirement.requirementId}
                  className="rounded-xl border border-[#E7E5F4] p-4"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-[#28262F]">
                          {requirement.type}
                        </h3>
                        <Badge
                          variant={stateVariant(derived.state)}
                          className={
                            derived.state === "complete" ? "bg-emerald-600" : ""
                          }
                        >
                          {stateCopy[derived.state]}
                        </Badge>
                        {requirement.isRequired === false && (
                          <Badge variant="outline">Optional</Badge>
                        )}
                        {requirement.isCustom && (
                          <Badge variant="outline">Custom</Badge>
                        )}
                      </div>
                      <div className="mt-2 space-y-1 text-xs text-[#77727F]">
                        {requirement.submittedDate && (
                          <p>
                            Submitted{" "}
                            {format(
                              new Date(requirement.submittedDate),
                              "MMM d, yyyy",
                            )}
                          </p>
                        )}
                        {requirement.expiryDate && (
                          <p>
                            Expires{" "}
                            {format(
                              new Date(requirement.expiryDate),
                              "MMM d, yyyy",
                            )}
                            {derived.daysUntilExpiry !== undefined &&
                            derived.daysUntilExpiry >= 0
                              ? ` · ${derived.daysUntilExpiry} days left`
                              : ""}
                          </p>
                        )}
                        {requirement.rejectionReason && (
                          <p className="font-medium text-red-700">
                            Returned: {requirement.rejectionReason}
                          </p>
                        )}
                        {requirement.verificationNotes && (
                          <p>Review note: {requirement.verificationNotes}</p>
                        )}
                        {auditEvents[0] && (
                          <p>
                            Audit trail: {auditEvents.length} event
                            {auditEvents.length === 1 ? "" : "s"} · Latest{" "}
                            {auditEvents[0].type}{" "}
                            {format(
                              new Date(auditEvents[0].occurredAt),
                              "MMM d, yyyy",
                            )}
                          </p>
                        )}
                      </div>
                    </div>
                    {requirement.isCustom && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-red-600"
                        disabled={busyIndex !== null}
                        onClick={() =>
                          perform(
                            index,
                            () =>
                              removeRequirement({
                                employeeId: employee._id,
                                requirementId: requirement.requirementId,
                              }),
                            "Custom requirement archived",
                          )
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <Label className="cursor-pointer">
                      <Input
                        type="file"
                        className="hidden"
                        accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
                        disabled={busyIndex !== null}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file)
                            uploadEvidence(
                              index,
                              requirement.requirementId,
                              file,
                            );
                          event.target.value = "";
                        }}
                      />
                      <span className="inline-flex h-9 items-center rounded-md border px-3 text-sm font-medium hover:bg-[#F7F6FA]">
                        <Upload className="mr-2 h-4 w-4" />
                        {requirement.file
                          ? "Replace evidence"
                          : "Upload evidence"}
                      </span>
                    </Label>
                    {requirement.file && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          onPreviewFile(
                            requirement.file as string,
                            requirement.type,
                          )
                        }
                      >
                        <Eye className="mr-2 h-4 w-4" /> View
                      </Button>
                    )}
                  </div>
                  {derived.state === "awaiting_review" && (
                    <div className="mt-4 grid gap-3 border-t pt-4">
                      <div className="space-y-1.5">
                        <Label htmlFor={`review-${index}`}>
                          Verification note
                        </Label>
                        <Input
                          id={`review-${index}`}
                          value={reviewNotes[index] ?? ""}
                          onChange={(event) =>
                            setReviewNotes({
                              ...reviewNotes,
                              [index]: event.target.value,
                            })
                          }
                          placeholder="Optional audit context"
                        />
                      </div>
                      <Button
                        size="sm"
                        className="w-fit bg-emerald-600 hover:bg-emerald-700"
                        disabled={busyIndex !== null}
                        onClick={() => verify(index, requirement.requirementId)}
                      >
                        <CheckCircle2 className="mr-2 h-4 w-4" /> Verify
                      </Button>
                      <div className="space-y-1.5">
                        <Label htmlFor={`reject-${index}`}>Return reason</Label>
                        <Textarea
                          id={`reject-${index}`}
                          rows={2}
                          value={rejectionReasons[index] ?? ""}
                          onChange={(event) =>
                            setRejectionReasons({
                              ...rejectionReasons,
                              [index]: event.target.value,
                            })
                          }
                          placeholder="Explain what must be corrected"
                        />
                      </div>
                      <Button
                        size="sm"
                        variant="destructive"
                        className="w-fit"
                        disabled={
                          busyIndex !== null || !rejectionReasons[index]?.trim()
                        }
                        onClick={() => reject(index, requirement.requirementId)}
                      >
                        <XCircle className="mr-2 h-4 w-4" /> Return submission
                      </Button>
                    </div>
                  )}
                  {derived.state === "expired" && (
                    <div className="mt-4 flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-800">
                      <FileWarning className="h-4 w-4" /> A replacement document
                      is required.
                    </div>
                  )}
                </section>
              );
            })
          )}
        </div>
        {historicalRequirements.length > 0 && (
          <section className="space-y-3 border-t pt-5">
            <div>
              <h3 className="text-sm font-semibold">Historical evidence</h3>
              <p className="text-xs text-[#77727F]">
                Retained from archived custom requirements and policies that no
                longer apply. These records do not affect current compliance.
              </p>
            </div>
            {historicalRequirements.map(({ requirement }) => (
              <div
                key={requirement.requirementId}
                className="flex items-center justify-between gap-3 rounded-xl border bg-[#FAFAFC] p-4"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">{requirement.type}</p>
                    {requirement.archivedAt !== undefined && (
                      <Badge variant="outline">Archived</Badge>
                    )}
                  </div>
                  <p className="text-xs capitalize text-[#77727F]">
                    {requirement.status.replace("_", " ")}
                    {requirement.submittedDate
                      ? ` · ${format(new Date(requirement.submittedDate), "MMM d, yyyy")}`
                      : ""}
                  </p>
                </div>
                {requirement.file && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      onPreviewFile(
                        requirement.file as string,
                        requirement.type,
                      )
                    }
                  >
                    <Eye className="mr-2 h-4 w-4" /> View evidence
                  </Button>
                )}
              </div>
            ))}
          </section>
        )}
      </DialogContent>
    </Dialog>
  );
}
