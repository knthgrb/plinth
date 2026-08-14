"use client";

import { useMemo, useState } from "react";
import { format } from "date-fns";
import {
  addApplicantScorecard,
  approveOffer,
  convertApplicantToEmployee,
  requestOfferApproval,
  scheduleInterview,
  updateApplicantStatus,
} from "@/actions/recruitment";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import {
  allowedApplicantTransitions,
  canDecideApplicantOffer,
  canRequestApplicantOffer,
  canScheduleApplicantInterview,
  canSubmitApplicantScorecard,
  formatApplicantStage,
  getApplicantStageAge,
  validateScorecard,
  type ApplicantStage,
} from "@/lib/recruitment/workflow";
import {
  errorMessage,
  type OrganizationMember,
  type RecruitmentApplicant,
  type RecruitmentJob,
} from "@/lib/recruitment/ui-types";
import {
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  GitBranch,
  Send,
  UserPlus,
  XCircle,
} from "lucide-react";

interface ApplicantWorkflowPanelProps {
  applicant: RecruitmentApplicant;
  job: RecruitmentJob;
  members: readonly OrganizationMember[];
  canApproveOffer: boolean;
  currentUserId?: string;
}

const scorecardLabels = ["Role expertise", "Communication", "Values alignment"];

export function ApplicantWorkflowPanel({
  applicant,
  job,
  members,
  canApproveOffer,
  currentUserId,
}: ApplicantWorkflowPanelProps) {
  const { toast } = useToast();
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [interview, setInterview] = useState({
    date: "",
    type: "Structured interview",
    interviewer: "",
    remarks: "",
  });
  const [scores, setScores] = useState<Record<string, string>>(
    Object.fromEntries(scorecardLabels.map((label) => [label, ""])),
  );
  const [recommendation, setRecommendation] = useState("");
  const [offerNotes, setOfferNotes] = useState("");
  const [conversion, setConversion] = useState({
    employeeId: "",
    position: job.position || job.title,
    department: job.department,
    employmentType: "regular" as
      | "regular"
      | "probationary"
      | "contractual"
      | "part-time",
    hireDate: "",
    basicSalary: "",
    salaryType: "monthly" as "monthly" | "daily" | "hourly",
  });

  const stageAge = getApplicantStageAge(applicant);
  const nextStages = allowedApplicantTransitions(applicant.status).filter(
    (stage) => stage !== "rejected" && stage !== "interview",
  );
  const activeMembers = useMemo(
    () => members.filter((member) => member.accessStatus === "active"),
    [members],
  );
  const workflowPrerequisites = {
    status: applicant.status,
    convertedEmployeeId: applicant.convertedEmployeeId,
    scorecardCount: applicant.scorecards.length,
    offerStatus: applicant.offerApproval?.status,
    offerRequestedBy: applicant.offerApproval?.requestedBy,
    currentUserId,
    canApproveOffer,
  };
  const canScheduleInterview = canScheduleApplicantInterview(
    workflowPrerequisites,
  );
  const canSubmitScorecard = canSubmitApplicantScorecard(workflowPrerequisites);
  const canRequestOffer = canRequestApplicantOffer(workflowPrerequisites);
  const canDecideOffer = canDecideApplicantOffer(workflowPrerequisites);

  async function perform(action: string, operation: () => Promise<unknown>) {
    setBusyAction(action);
    try {
      await operation();
      toast({
        title: "Workflow updated",
        description: "The candidate record is up to date.",
      });
    } catch (error: unknown) {
      toast({
        title: "Unable to update workflow",
        description: errorMessage(error, "Please try again."),
        variant: "destructive",
      });
    } finally {
      setBusyAction(null);
    }
  }

  function moveTo(stage: ApplicantStage) {
    return perform(`stage-${stage}`, () =>
      updateApplicantStatus(applicant._id, stage),
    );
  }

  function rejectApplicant() {
    return perform("reject", async () => {
      await updateApplicantStatus(applicant._id, "rejected", rejectionReason);
      setRejectionReason("");
    });
  }

  function submitInterview() {
    const date = new Date(interview.date).getTime();
    if (!Number.isFinite(date)) {
      toast({ title: "Interview date is required", variant: "destructive" });
      return;
    }
    return perform("interview", async () => {
      await scheduleInterview({
        applicantId: applicant._id,
        date,
        type: interview.type,
        interviewer: interview.interviewer,
        remarks: interview.remarks.trim() || undefined,
      });
      setInterview((current) => ({ ...current, date: "", remarks: "" }));
    });
  }

  function submitScorecard() {
    const criteria = scorecardLabels.map((label) => ({
      label,
      score: Number(scores[label]),
    }));
    try {
      validateScorecard(criteria);
    } catch (error: unknown) {
      toast({
        title: "Scorecard is incomplete",
        description: errorMessage(
          error,
          "Enter a score from 1 to 5 for every criterion.",
        ),
        variant: "destructive",
      });
      return;
    }
    return perform("scorecard", async () => {
      await addApplicantScorecard({
        applicantId: applicant._id,
        criteria,
        recommendation: recommendation.trim() || undefined,
      });
      setScores(
        Object.fromEntries(scorecardLabels.map((label) => [label, ""])),
      );
      setRecommendation("");
    });
  }

  function requestOffer() {
    return perform("offer-request", async () => {
      await requestOfferApproval({
        applicantId: applicant._id,
        notes: offerNotes.trim() || undefined,
      });
      setOfferNotes("");
    });
  }

  function decideOffer(approved: boolean) {
    return perform(approved ? "offer-approve" : "offer-decline", () =>
      approveOffer({
        applicantId: applicant._id,
        approved,
        notes: offerNotes.trim() || undefined,
      }),
    );
  }

  function convertApplicant() {
    const hireDate = new Date(`${conversion.hireDate}T00:00:00`).getTime();
    return perform("convert", () =>
      convertApplicantToEmployee({
        applicantId: applicant._id,
        employeeData: {
          employeeId: conversion.employeeId,
          position: conversion.position,
          department: conversion.department,
          employmentType: conversion.employmentType,
          hireDate,
          basicSalary: Number(conversion.basicSalary),
          salaryType: conversion.salaryType,
        },
      }),
    );
  }

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-[#E7E5F4] bg-[#FBFAFF] p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-[#695eff]" />
              <h3 className="text-sm font-semibold text-[#28262F]">Pipeline</h3>
            </div>
            <p className="mt-1 text-xs text-[#77727F]">
              In {formatApplicantStage(applicant.status)} for {stageAge.days}{" "}
              day{stageAge.days === 1 ? "" : "s"}
            </p>
          </div>
          <Badge
            variant={stageAge.isStale ? "destructive" : "secondary"}
            className="capitalize"
          >
            {formatApplicantStage(applicant.status)}
          </Badge>
        </div>
        {applicant.convertedEmployeeId ? (
          <div className="mt-4 flex items-center gap-2 text-sm text-emerald-700">
            <CheckCircle2 className="h-4 w-4" /> Employee record created
          </div>
        ) : (
          <div className="mt-4 flex flex-wrap gap-2">
            {nextStages.map((stage) => (
              <Button
                key={stage}
                size="sm"
                variant="outline"
                disabled={busyAction !== null}
                onClick={() => moveTo(stage)}
              >
                Move to {formatApplicantStage(stage)}
              </Button>
            ))}
          </div>
        )}
        <div className="mt-4 space-y-2 border-t border-[#E7E5F4] pt-4">
          <Label htmlFor="rejectionReason">Reject with reason</Label>
          <Textarea
            id="rejectionReason"
            rows={2}
            value={rejectionReason}
            onChange={(event) => setRejectionReason(event.target.value)}
            placeholder="Record a job-related reason"
          />
          <Button
            size="sm"
            variant="destructive"
            disabled={
              !rejectionReason.trim() ||
              busyAction !== null ||
              applicant.status === "hired"
            }
            onClick={rejectApplicant}
          >
            <XCircle className="mr-2 h-4 w-4" /> Reject candidate
          </Button>
        </div>
      </section>

      <details
        className="rounded-xl border p-4"
        open={applicant.status === "screening"}
      >
        <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold">
          <CalendarClock className="h-4 w-4 text-[#695eff]" /> Schedule
          interview
        </summary>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="interviewDate">Date and time</Label>
            <Input
              id="interviewDate"
              type="datetime-local"
              value={interview.date}
              disabled={!canScheduleInterview}
              onChange={(event) =>
                setInterview({ ...interview, date: event.target.value })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label>Interviewer</Label>
            <Select
              value={interview.interviewer}
              disabled={!canScheduleInterview}
              onValueChange={(interviewer) =>
                setInterview({ ...interview, interviewer })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select member" />
              </SelectTrigger>
              <SelectContent>
                {activeMembers.map((member) => (
                  <SelectItem key={member._id} value={member._id}>
                    {member.name || member.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="interviewRemarks">Focus or preparation notes</Label>
            <Textarea
              id="interviewRemarks"
              rows={2}
              value={interview.remarks}
              disabled={!canScheduleInterview}
              onChange={(event) =>
                setInterview({ ...interview, remarks: event.target.value })
              }
            />
          </div>
          <Button
            className="sm:col-span-2"
            disabled={
              !interview.date ||
              !interview.interviewer ||
              busyAction !== null ||
              !canScheduleInterview
            }
            onClick={submitInterview}
          >
            Schedule and move to interview
          </Button>
        </div>
        {applicant.interviewSchedules.length > 0 && (
          <div className="mt-4 space-y-2 border-t pt-3">
            {applicant.interviewSchedules.map((scheduledInterview, index) => (
              <p
                key={`${scheduledInterview.date}-${index}`}
                className="text-xs text-[#77727F]"
              >
                {format(
                  new Date(scheduledInterview.date),
                  "MMM d, yyyy 'at' h:mm a",
                )}{" "}
                · {scheduledInterview.type}
              </p>
            ))}
          </div>
        )}
      </details>

      <details
        className="rounded-xl border p-4"
        open={
          applicant.status === "interview" || applicant.status === "assessment"
        }
      >
        <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold">
          <ClipboardCheck className="h-4 w-4 text-[#695eff]" /> Scorecard
        </summary>
        <div className="mt-4 space-y-3">
          {scorecardLabels.map((label) => (
            <div
              key={label}
              className="grid grid-cols-[1fr_88px] items-center gap-3"
            >
              <Label htmlFor={`score-${label}`}>{label}</Label>
              <Input
                id={`score-${label}`}
                type="number"
                min="1"
                max="5"
                value={scores[label]}
                disabled={!canSubmitScorecard}
                onChange={(event) =>
                  setScores({ ...scores, [label]: event.target.value })
                }
                placeholder="1–5"
              />
            </div>
          ))}
          <Textarea
            rows={2}
            value={recommendation}
            disabled={!canSubmitScorecard}
            onChange={(event) => setRecommendation(event.target.value)}
            placeholder="Recommendation and evidence"
          />
          <Button
            disabled={busyAction !== null || !canSubmitScorecard}
            onClick={submitScorecard}
          >
            Submit scorecard
          </Button>
        </div>
        {applicant.scorecards.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2 border-t pt-3">
            {applicant.scorecards.map((scorecard, index) => (
              <Badge
                key={`${scorecard.submittedAt}-${index}`}
                variant="outline"
              >
                Score {scorecard.overallScore}/5
              </Badge>
            ))}
          </div>
        )}
      </details>

      <details
        className="rounded-xl border p-4"
        open={applicant.status === "offer"}
      >
        <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold">
          <Send className="h-4 w-4 text-[#695eff]" /> Offer approval
        </summary>
        <div className="mt-4 space-y-3">
          <p className="text-sm text-[#77727F]">
            Current decision:{" "}
            <span className="font-medium capitalize text-[#28262F]">
              {applicant.offerApproval?.status ?? "not requested"}
            </span>
          </p>
          {applicant.offerHistory.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {applicant.offerHistory.map((event, index) => (
                <Badge
                  key={`${event.cycle ?? 0}-${event.eventIndex ?? index}`}
                  variant="outline"
                  className="capitalize"
                >
                  Cycle {event.cycle ?? 1}: {event.status}
                </Badge>
              ))}
            </div>
          )}
          <Textarea
            rows={2}
            value={offerNotes}
            disabled={
              applicant.offerApproval?.status === "approved" ||
              applicant.convertedEmployeeId !== undefined
            }
            onChange={(event) => setOfferNotes(event.target.value)}
            placeholder="Compensation context or approval notes"
          />
          {!applicant.offerApproval ||
          applicant.offerApproval.status === "rejected" ? (
            <Button
              disabled={busyAction !== null || !canRequestOffer}
              onClick={requestOffer}
            >
              Request offer approval
            </Button>
          ) : applicant.offerApproval.status === "pending" && canDecideOffer ? (
            <div className="flex gap-2">
              <Button
                disabled={busyAction !== null}
                onClick={() => decideOffer(true)}
              >
                Approve offer
              </Button>
              <Button
                variant="destructive"
                disabled={busyAction !== null}
                onClick={() => decideOffer(false)}
              >
                Decline
              </Button>
            </div>
          ) : applicant.offerApproval.status === "pending" ? (
            <p className="text-xs text-amber-700">
              Waiting for another owner or admin to decide.
            </p>
          ) : (
            <p className="text-xs text-emerald-700">
              Approved and ready for employee conversion.
            </p>
          )}
        </div>
      </details>

      {applicant.offerApproval?.status === "approved" &&
        !applicant.convertedEmployeeId && (
          <details
            className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4"
            open
          >
            <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold">
              <UserPlus className="h-4 w-4 text-emerald-700" /> Convert to
              employee
            </summary>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Employee ID</Label>
                <Input
                  value={conversion.employeeId}
                  onChange={(event) =>
                    setConversion({
                      ...conversion,
                      employeeId: event.target.value,
                    })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>Hire date</Label>
                <Input
                  type="date"
                  value={conversion.hireDate}
                  onChange={(event) =>
                    setConversion({
                      ...conversion,
                      hireDate: event.target.value,
                    })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>Position</Label>
                <Input
                  value={conversion.position}
                  onChange={(event) =>
                    setConversion({
                      ...conversion,
                      position: event.target.value,
                    })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>Department</Label>
                <Input
                  value={conversion.department}
                  onChange={(event) =>
                    setConversion({
                      ...conversion,
                      department: event.target.value,
                    })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>Employment type</Label>
                <Select
                  value={conversion.employmentType}
                  onValueChange={(
                    employmentType: typeof conversion.employmentType,
                  ) => setConversion({ ...conversion, employmentType })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="regular">Regular</SelectItem>
                    <SelectItem value="probationary">Probationary</SelectItem>
                    <SelectItem value="contractual">Contractual</SelectItem>
                    <SelectItem value="part-time">Part-time</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Basic salary</Label>
                <Input
                  type="number"
                  min="0"
                  value={conversion.basicSalary}
                  onChange={(event) =>
                    setConversion({
                      ...conversion,
                      basicSalary: event.target.value,
                    })
                  }
                />
              </div>
              <Button
                className="sm:col-span-2"
                disabled={
                  busyAction !== null ||
                  !conversion.employeeId.trim() ||
                  !conversion.hireDate ||
                  Number(conversion.basicSalary) <= 0
                }
                onClick={convertApplicant}
              >
                Create employee record
              </Button>
            </div>
          </details>
        )}
    </div>
  );
}
