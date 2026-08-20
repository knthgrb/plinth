"use client";

import { useMemo, useState } from "react";
import { useConvex, useMutation, useQuery } from "convex/react";
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  FileUp,
  ShieldCheck,
} from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { createUploadIntent, registerUploadedFile } from "@/actions/files";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import {
  applyLeavePreview,
  buildLeaveDraftFingerprint,
  canSubmitLeaveDraft,
  createLeaveRequestDraft,
  getAllowedDurationModes,
  getEmployeePolicyLabel,
  setLeaveDraftBenefitEvent,
  setLeaveDraftBenefitEventId,
  setLeaveDraftField,
  type EmployeeLeavePolicyOption,
  type LeaveDurationMode,
  type LeaveRequestPreview,
} from "@/lib/leave/employee-workspace";
import type { LeaveBenefitEventType } from "@/lib/leave/types";

function parseStorageId(responseText: string): string {
  try {
    const parsed = JSON.parse(responseText) as { storageId?: string } | string;
    if (typeof parsed === "string") return parsed.trim();
    if (parsed.storageId) return parsed.storageId.trim();
  } catch {
    const value = responseText.trim().replace(/^["']|["']$/g, "");
    if (value) return value;
  }
  throw new Error("Storage upload did not return a file ID");
}

const steps = ["Policy", "Duration", "Preview", "Evidence", "Confirm"] as const;

const benefitEventLabels: Record<LeaveBenefitEventType, string> = {
  maternity: "Live childbirth",
  miscarriage: "Miscarriage",
  emergency_termination_of_pregnancy: "Emergency termination of pregnancy",
  spouse_delivery: "Spouse delivery",
  surgery: "Surgery",
  adoption: "Adoption",
  calamity: "Calamity",
  other_protected: "Other protected event",
};

function availableBenefitEventTypes(
  policy: EmployeeLeavePolicyOption | undefined,
): LeaveBenefitEventType[] {
  const configured = [
    ...new Set(
      (policy?.eventEntitlementRules ?? []).map((rule) => rule.eventType),
    ),
  ];
  if (configured.length > 0) return configured;
  const sourceKey = policy?.sourceKey ?? "";
  if (sourceKey.includes("maternity")) {
    return [
      "maternity",
      "miscarriage",
      "emergency_termination_of_pregnancy",
    ];
  }
  if (sourceKey.includes("paternity")) return ["spouse_delivery"];
  if (sourceKey.includes("women")) return ["surgery"];
  if (sourceKey.includes("adoption")) return ["adoption"];
  if (sourceKey.includes("emergency")) return ["calamity"];
  return ["other_protected"];
}

function payTreatmentLabel(value: LeaveRequestPreview["policy"]["payTreatment"]): string {
  const labels: Record<LeaveRequestPreview["policy"]["payTreatment"], string> = {
    company_paid: "Company paid",
    statutory_paid: "Statutory paid",
    government_paid: "Government paid",
    statutory_benefit_supported: "Supported by statutory benefit",
    unpaid: "Unpaid",
  };
  return labels[value];
}

export function LeaveRequestDrawer(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: Id<"organizations">;
  employeeId: Id<"employees">;
  policies: readonly EmployeeLeavePolicyOption[];
}) {
  const convex = useConvex();
  const submitRequest = useMutation(api.leave.createLeaveRequestV2);
  const verifiedEvents = useQuery(
    api.leaveQualifications.getMyVerifiedLeaveBenefitEvents,
    props.open
      ? { organizationId: props.organizationId, employeeId: props.employeeId }
      : "skip",
  );
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState(() =>
    createLeaveRequestDraft({
      policyId: props.policies[0]?.policyId,
      allowHalfDay: props.policies[0]?.allowHalfDay,
      allowHourly: props.policies[0]?.allowHourly,
      qualifyingEventRequired: props.policies[0]?.qualifyingEventRequired,
    }),
  );
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadingDocumentType, setUploadingDocumentType] = useState<string>();
  const selectedPolicy = props.policies.find(
    (policy) => policy.policyId === draft.policyId,
  );
  const allowedModes = getAllowedDurationModes({
    allowHalfDay: selectedPolicy?.allowHalfDay ?? false,
    allowHourly: selectedPolicy?.allowHourly ?? false,
  });
  const attachedDocumentTypes = useMemo(
    () => new Set(draft.attachments.map((attachment) => attachment.documentType)),
    [draft.attachments],
  );

  const reset = () => {
    const firstPolicy = props.policies[0];
    setStep(0);
    setDraft(
      createLeaveRequestDraft({
        policyId: firstPolicy?.policyId,
        allowHalfDay: firstPolicy?.allowHalfDay,
        allowHourly: firstPolicy?.allowHourly,
        qualifyingEventRequired: firstPolicy?.qualifyingEventRequired,
      }),
    );
    setUploadingDocumentType(undefined);
  };

  const setOpen = (open: boolean) => {
    if (!open && !isSubmitting) reset();
    props.onOpenChange(open);
  };

  const selectPolicy = (policyId: string) => {
    const policy = props.policies.find((item) => item.policyId === policyId);
    setDraft((current) => ({
      ...setLeaveDraftField(current, "policyId", policyId),
      requestedDurationMode: "day",
      requestedMinutes: undefined,
      allowHalfDay: policy?.allowHalfDay ?? false,
      allowHourly: policy?.allowHourly ?? false,
      qualifyingEventRequired: policy?.qualifyingEventRequired ?? false,
      benefitEventId: undefined,
      benefitEventDraft: undefined,
    }));
  };

  const preview = async () => {
    if (!draft.policyId || !draft.startLocalDate || !draft.endLocalDate) {
      toast({
        title: "Choose a policy and leave dates",
        variant: "destructive",
      });
      return;
    }
    const fingerprint = buildLeaveDraftFingerprint(draft);
    setIsPreviewing(true);
    try {
      const result = await convex.query(api.leave.previewLeaveRequestV2, {
        organizationId: props.organizationId,
        employeeId: props.employeeId,
        policyId: draft.policyId as Id<"leavePolicies">,
        startLocalDate: draft.startLocalDate,
        endLocalDate: draft.endLocalDate,
        requestedDurationMode: draft.requestedDurationMode,
        requestedMinutes:
          draft.requestedDurationMode === "hour"
            ? draft.requestedMinutes
            : undefined,
        benefitEventDraft: draft.benefitEventDraft,
        benefitEventId: draft.benefitEventId as
          | Id<"leaveBenefitEvents">
          | undefined,
      });
      const normalized: LeaveRequestPreview = {
        ...result,
        policy: {
          ...result.policy,
          policyId: String(result.policy.policyId),
          policyVersionId: String(result.policy.policyVersionId),
        },
      };
      setDraft((current) => applyLeavePreview(current, normalized, fingerprint));
      setStep(2);
    } catch (error: unknown) {
      toast({
        title: "Unable to preview leave",
        description:
          error instanceof Error ? error.message : "Please review the dates.",
        variant: "destructive",
      });
    } finally {
      setIsPreviewing(false);
    }
  };

  const uploadEvidence = async (file: File, documentType: string) => {
    setUploadingDocumentType(documentType);
    try {
      const { intentId, uploadUrl } = await createUploadIntent(
        String(props.organizationId),
        "leave_attachment",
      );
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!response.ok) throw new Error(`Failed to upload ${file.name}`);
      const storageId = parseStorageId(await response.text());
      const storageObjectId = await registerUploadedFile(intentId, storageId, {
        fileName: file.name,
      });
      setDraft((current) => ({
        ...current,
        attachments: [
          ...current.attachments.filter(
            (attachment) => attachment.documentType !== documentType,
          ),
          { storageObjectId, documentType, fileName: file.name },
        ],
      }));
    } catch (error: unknown) {
      toast({
        title: "Evidence upload failed",
        description:
          error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setUploadingDocumentType(undefined);
    }
  };

  const submit = async () => {
    if (!draft.preview || !canSubmitLeaveDraft(draft)) return;
    setIsSubmitting(true);
    try {
      await submitRequest({
        organizationId: props.organizationId,
        employeeId: props.employeeId,
        policyId: draft.policyId as Id<"leavePolicies">,
        startLocalDate: draft.startLocalDate,
        endLocalDate: draft.endLocalDate,
        requestedDurationMode: draft.requestedDurationMode,
        requestedMinutes:
          draft.requestedDurationMode === "hour"
            ? draft.requestedMinutes
            : undefined,
        benefitEventDraft: draft.benefitEventDraft,
        benefitEventId: draft.benefitEventId as
          | Id<"leaveBenefitEvents">
          | undefined,
        reason: draft.reason.trim(),
        attachments: draft.attachments.map((attachment) => ({
          storageObjectId:
            attachment.storageObjectId as Id<"storageObjects">,
          documentType: attachment.documentType,
        })),
      });
      toast({ title: "Leave request submitted" });
      reset();
      props.onOpenChange(false);
    } catch (error: unknown) {
      toast({
        title: "Unable to submit leave",
        description:
          error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderStep = () => {
    if (step === 0) {
      return (
        <div className="space-y-3">
          <div>
            <h3 className="font-medium">Choose a leave policy</h3>
            <p className="text-sm text-muted-foreground">
              Only policies currently available to your employee record are shown.
            </p>
          </div>
          <div className="grid gap-3">
            {props.policies.map((policy) => {
              const selected = policy.policyId === draft.policyId;
              return (
                <button
                  key={policy.policyId}
                  type="button"
                  onClick={() => selectPolicy(policy.policyId)}
                  className={`flex items-start justify-between rounded-xl border p-4 text-left transition-colors ${
                    selected
                      ? "border-brand-purple bg-brand-purple/5"
                      : "hover:bg-muted/40"
                  }`}
                >
                  <span>
                    <span className="block text-sm font-medium">
                      {getEmployeePolicyLabel(policy)}
                    </span>
                    <span className="mt-1 block text-xs capitalize text-muted-foreground">
                      {policy.category} leave
                    </span>
                  </span>
                  {selected ? <Check className="h-4 w-4 text-brand-purple" /> : null}
                </button>
              );
            })}
          </div>
        </div>
      );
    }

    if (step === 1) {
      const eventTypes = availableBenefitEventTypes(selectedPolicy);
      const requiresVerifiedEvent =
        selectedPolicy?.requiresVerifiedBenefitEvent === true;
      const reusableEvents =
        verifiedEvents?.filter((event) =>
          eventTypes.includes(event.eventType),
        ) ?? [];
      return (
        <div className="space-y-5">
          {selectedPolicy?.qualifyingEventRequired ? (
            <div className="space-y-4 rounded-xl border bg-muted/20 p-4">
              <div>
                <h3 className="font-medium">Qualifying event</h3>
                <p className="text-sm text-muted-foreground">
                  HR will verify this private event and its evidence before
                  approving the leave.
                </p>
              </div>
              {reusableEvents.length > 0 ? (
                <div className="space-y-2">
                  <Label htmlFor="leave-existing-event">Event record</Label>
                  <Select
                    value={
                      draft.benefitEventId ??
                      (requiresVerifiedEvent ? "" : "new")
                    }
                    onValueChange={(value) =>
                      setDraft((current) =>
                        value === "new"
                          ? setLeaveDraftBenefitEventId(current, undefined)
                          : setLeaveDraftBenefitEventId(current, value),
                      )
                    }
                  >
                    <SelectTrigger id="leave-existing-event">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {!requiresVerifiedEvent ? (
                        <SelectItem value="new">Record a new event</SelectItem>
                      ) : null}
                      {reusableEvents.map((event) => (
                        <SelectItem
                          key={event.benefitEventId}
                          value={event.benefitEventId}
                        >
                          {benefitEventLabels[event.eventType]} · {new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeZone: "Asia/Manila" }).format(event.qualifyingDate)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : requiresVerifiedEvent ? (
                <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                  Complete and verify the main maternity leave event before
                  filing its optional unpaid extension.
                </p>
              ) : null}
              {!draft.benefitEventId && !requiresVerifiedEvent ? (
                <>
              <div className="space-y-2">
                <Label htmlFor="leave-event-type">Event type</Label>
                <Select
                  value={draft.benefitEventDraft?.eventType ?? ""}
                  onValueChange={(value: LeaveBenefitEventType) =>
                    setDraft((current) =>
                      setLeaveDraftBenefitEvent(current, {
                        eventType: value,
                        qualifyingLocalDate:
                          current.benefitEventDraft?.qualifyingLocalDate ?? "",
                        ...(value === "maternity"
                          ? { benefitVariant: "live_birth" }
                          : {}),
                      }),
                    )
                  }
                >
                  <SelectTrigger id="leave-event-type">
                    <SelectValue placeholder="Select the qualifying event" />
                  </SelectTrigger>
                  <SelectContent>
                    {eventTypes.map((eventType) => (
                      <SelectItem key={eventType} value={eventType}>
                        {benefitEventLabels[eventType]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {draft.benefitEventDraft?.eventType === "maternity" ? (
                <div className="space-y-2">
                  <Label htmlFor="leave-maternity-variant">
                    Maternity entitlement
                  </Label>
                  <Select
                    value={
                      draft.benefitEventDraft.benefitVariant ?? "live_birth"
                    }
                    onValueChange={(benefitVariant) =>
                      setDraft((current) =>
                        current.benefitEventDraft
                          ? setLeaveDraftBenefitEvent(current, {
                              ...current.benefitEventDraft,
                              benefitVariant,
                            })
                          : current,
                      )
                    }
                  >
                    <SelectTrigger id="leave-maternity-variant">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="live_birth">
                        Live childbirth · up to 105 days
                      </SelectItem>
                      <SelectItem value="live_birth_solo_parent">
                        Live childbirth, qualified solo parent · up to 120 days
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              <div className="space-y-2">
                <Label htmlFor="leave-qualifying-date">
                  Expected or actual event date
                </Label>
                <Input
                  id="leave-qualifying-date"
                  type="date"
                  value={draft.benefitEventDraft?.qualifyingLocalDate ?? ""}
                  disabled={!draft.benefitEventDraft}
                  onChange={(event) =>
                    setDraft((current) =>
                      current.benefitEventDraft
                        ? setLeaveDraftBenefitEvent(current, {
                            ...current.benefitEventDraft,
                            qualifyingLocalDate: event.target.value,
                          })
                        : current,
                    )
                  }
                />
              </div>
                </>
              ) : draft.benefitEventId ? (
                <p className="rounded-lg bg-background p-3 text-sm text-muted-foreground">
                  The verified event will be reused. The policy limit is still
                  checked against prior requests for that event.
                </p>
              ) : null}
            </div>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="leave-start-date">Start date</Label>
              <Input
                id="leave-start-date"
                type="date"
                value={draft.startLocalDate}
                onChange={(event) =>
                  setDraft((current) =>
                    setLeaveDraftField(
                      current,
                      "startLocalDate",
                      event.target.value,
                    ),
                  )
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="leave-end-date">End date</Label>
              <Input
                id="leave-end-date"
                type="date"
                min={draft.startLocalDate || undefined}
                value={draft.endLocalDate}
                onChange={(event) =>
                  setDraft((current) =>
                    setLeaveDraftField(
                      current,
                      "endLocalDate",
                      event.target.value,
                    ),
                  )
                }
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="leave-duration-mode">Duration</Label>
            <Select
              value={draft.requestedDurationMode}
              onValueChange={(value: LeaveDurationMode) =>
                setDraft((current) =>
                  setLeaveDraftField(current, "requestedDurationMode", value),
                )
              }
            >
              <SelectTrigger id="leave-duration-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {allowedModes.map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    {mode === "day"
                      ? "Full day"
                      : mode === "half_day"
                        ? "Half day"
                        : "Hourly"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {draft.requestedDurationMode === "hour" ? (
            <div className="space-y-2">
              <Label htmlFor="leave-requested-minutes">Minutes requested</Label>
              <Input
                id="leave-requested-minutes"
                type="number"
                min="1"
                value={draft.requestedMinutes ?? ""}
                onChange={(event) =>
                  setDraft((current) =>
                    setLeaveDraftField(
                      current,
                      "requestedMinutes",
                      event.target.value ? Number(event.target.value) : undefined,
                    ),
                  )
                }
              />
            </div>
          ) : null}
          <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
            <CalendarDays className="mr-2 inline h-4 w-4 text-brand-purple" />
            The server will exclude rest days and configured holidays when the
            policy uses scheduled work days.
          </div>
        </div>
      );
    }

    if (step === 2 && draft.preview) {
      return (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border p-4">
              <p className="text-xs text-muted-foreground">Chargeable</p>
              <p className="mt-1 text-xl font-semibold">
                {draft.preview.chargeableDuration} days
              </p>
            </div>
            <div className="rounded-xl border p-4">
              <p className="text-xs text-muted-foreground">Available</p>
              <p className="mt-1 text-xl font-semibold">
                {draft.preview.availableBalance ?? "Not credit based"}
              </p>
            </div>
            <div className="rounded-xl border p-4">
              <p className="text-xs text-muted-foreground">After request</p>
              <p className="mt-1 text-xl font-semibold">
                {draft.preview.remainingBalance ?? "—"}
              </p>
            </div>
          </div>
          <div className="rounded-xl border p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium">Pay treatment</p>
              <Badge variant="secondary">
                {payTreatmentLabel(draft.preview.policy.payTreatment)}
              </Badge>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              This value comes from the effective server policy and cannot be
              changed on the request.
            </p>
          </div>
          <div>
            <h3 className="text-sm font-medium">Schedule preview</h3>
            <div className="mt-2 divide-y overflow-hidden rounded-xl border">
              {draft.preview.occurrences.map((occurrence) => (
                <div
                  key={occurrence.localDate}
                  className="flex items-center justify-between gap-3 p-3 text-sm"
                >
                  <span>{occurrence.localDate}</span>
                  <span className="text-right text-muted-foreground">
                    {occurrence.isHoliday
                      ? "Holiday · "
                      : occurrence.isRestDay
                        ? "Rest day · "
                        : ""}
                    {occurrence.leaveMinutes} leave minutes · {occurrence.creditAmount} credit
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    }

    if (step === 3 && draft.preview) {
      return (
        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="leave-reason">Reason</Label>
            <Textarea
              id="leave-reason"
              value={draft.reason}
              onChange={(event) =>
                setDraft((current) =>
                  setLeaveDraftField(current, "reason", event.target.value),
                )
              }
              placeholder="Briefly explain your request"
              className="min-h-28"
            />
          </div>
          {draft.preview.requiredDocuments.length > 0 ? (
            <div className="space-y-3">
              <div>
                <h3 className="text-sm font-medium">Required evidence</h3>
                <p className="text-xs text-muted-foreground">
                  Required by the effective policy before submission.
                </p>
              </div>
              {draft.preview.requiredDocuments.map((documentType) => {
                const attachment = draft.attachments.find(
                  (item) => item.documentType === documentType,
                );
                return (
                  <label
                    key={documentType}
                    className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border p-4"
                  >
                    <span>
                      <span className="block text-sm font-medium capitalize">
                        {documentType.replaceAll("_", " ")}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {attachment?.fileName ?? "PDF or image"}
                      </span>
                    </span>
                    <span className="inline-flex items-center text-sm font-medium text-brand-purple">
                      {attachedDocumentTypes.has(documentType) ? (
                        <Check className="mr-1.5 h-4 w-4" />
                      ) : (
                        <FileUp className="mr-1.5 h-4 w-4" />
                      )}
                      {uploadingDocumentType === documentType
                        ? "Uploading…"
                        : attachedDocumentTypes.has(documentType)
                          ? "Replace"
                          : "Upload"}
                    </span>
                    <input
                      type="file"
                      className="sr-only"
                      disabled={uploadingDocumentType !== undefined}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void uploadEvidence(file, documentType);
                        event.target.value = "";
                      }}
                    />
                  </label>
                );
              })}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
              No evidence is required before submission for this request.
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="space-y-5">
        <div className="rounded-xl border border-brand-purple/20 bg-brand-purple/5 p-5">
          <ShieldCheck className="h-6 w-6 text-brand-purple" />
          <h3 className="mt-3 font-semibold">Ready to submit</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Your latest server preview matches these dates and all required
            evidence is attached.
          </p>
        </div>
        <dl className="grid gap-3 rounded-xl border p-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Policy</dt>
            <dd className="mt-1 font-medium">
              {selectedPolicy
                ? getEmployeePolicyLabel(selectedPolicy)
                : "Leave request"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Dates</dt>
            <dd className="mt-1 font-medium">
              {draft.startLocalDate} – {draft.endLocalDate}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Chargeable duration</dt>
            <dd className="mt-1 font-medium">
              {draft.preview?.chargeableDuration ?? 0} days
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Pay treatment</dt>
            <dd className="mt-1 font-medium">
              {draft.preview
                ? payTreatmentLabel(draft.preview.policy.payTreatment)
                : "Pending preview"}
            </dd>
          </div>
        </dl>
      </div>
    );
  };

  const canContinueEvidence =
    Boolean(draft.reason.trim()) &&
    Boolean(draft.preview) &&
    (draft.preview?.requiredDocuments.every((type) =>
      attachedDocumentTypes.has(type),
    ) ?? false);

  return (
    <Sheet open={props.open} onOpenChange={setOpen}>
      <SheetContent className="flex w-full flex-col overflow-hidden sm:max-w-2xl">
        <SheetHeader className="border-b pb-4 pr-8">
          <SheetTitle>Request leave</SheetTitle>
          <SheetDescription>
            Step {step + 1} of {steps.length}: {steps[step]}
          </SheetDescription>
          <div className="grid grid-cols-5 gap-1 pt-2" aria-label="Request progress">
            {steps.map((label, index) => (
              <div key={label} className="space-y-1">
                <div
                  className={`h-1.5 rounded-full ${
                    index <= step ? "bg-brand-purple" : "bg-muted"
                  }`}
                />
                <span className="sr-only">{label}</span>
              </div>
            ))}
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto py-6 pr-1">{renderStep()}</div>

        <SheetFooter className="gap-2 border-t pt-4 sm:space-x-0">
          {step > 0 ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => setStep((current) => Math.max(0, current - 1))}
              disabled={isSubmitting}
            >
              <ChevronLeft className="mr-2 h-4 w-4" /> Back
            </Button>
          ) : null}
          {step === 0 ? (
            <Button
              type="button"
              onClick={() => setStep(1)}
              disabled={!draft.policyId}
            >
              Continue <ChevronRight className="ml-2 h-4 w-4" />
            </Button>
          ) : null}
          {step === 1 ? (
            <Button
              type="button"
              onClick={() => void preview()}
              disabled={
                isPreviewing ||
                !draft.startLocalDate ||
                !draft.endLocalDate ||
                (draft.requestedDurationMode === "hour" &&
                  (!draft.requestedMinutes || draft.requestedMinutes <= 0)) ||
                (draft.qualifyingEventRequired &&
                  (!draft.benefitEventDraft?.eventType ||
                    !draft.benefitEventDraft.qualifyingLocalDate))
              }
            >
              {isPreviewing ? "Calculating…" : "Preview request"}
            </Button>
          ) : null}
          {step === 2 ? (
            <Button type="button" onClick={() => setStep(3)}>
              Add reason and evidence <ChevronRight className="ml-2 h-4 w-4" />
            </Button>
          ) : null}
          {step === 3 ? (
            <Button
              type="button"
              onClick={() => setStep(4)}
              disabled={!canContinueEvidence || uploadingDocumentType !== undefined}
            >
              Review submission <ChevronRight className="ml-2 h-4 w-4" />
            </Button>
          ) : null}
          {step === 4 ? (
            <Button
              type="button"
              onClick={() => void submit()}
              disabled={!canSubmitLeaveDraft(draft) || isSubmitting}
            >
              {isSubmitting ? "Submitting…" : "Submit request"}
            </Button>
          ) : null}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
