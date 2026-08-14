export const APPLICANT_STAGES = [
  "new",
  "screening",
  "interview",
  "assessment",
  "offer",
  "hired",
  "rejected",
] as const;

export type ApplicantStage = (typeof APPLICANT_STAGES)[number];
export type OfferApprovalStatus =
  | "not_requested"
  | "pending"
  | "approved"
  | "rejected";

export interface ApplicantTransitionContext {
  rejectionReason?: string;
  convertedEmployeeId?: string;
}

export interface ApplicantStageEvent {
  to: string;
  changedAt: number;
}

export interface ApplicantStageSnapshot {
  status: ApplicantStage;
  appliedDate: number;
  pipelineStageHistory: readonly ApplicantStageEvent[];
}

export interface ApplicantStageAge {
  enteredAt: number;
  days: number;
  isStale: boolean;
}

export interface ScorecardCriterion {
  label: string;
  score: number;
  notes?: string;
}

export interface RecruitmentPositionSnapshot {
  id: string;
  status: "open" | "closed" | "on-hold";
  numberOfOpenings: number;
}

export interface RecruitmentApplicantSnapshot extends ApplicantStageSnapshot {
  jobId: string;
}

export interface RecruitmentPipelineSummary {
  activePositions: number;
  openHeadcount: number;
  totalApplicants: number;
  activeCandidates: number;
  awaitingDecision: number;
  staleCandidates: number;
  stageCounts: Record<ApplicantStage, number>;
}

const DAY_IN_MS = 24 * 60 * 60 * 1_000;

const TRANSITIONS: Record<ApplicantStage, readonly ApplicantStage[]> = {
  new: ["screening", "rejected"],
  screening: ["interview", "assessment", "rejected"],
  interview: ["assessment", "rejected"],
  assessment: ["interview", "rejected"],
  offer: ["rejected"],
  hired: [],
  rejected: ["screening"],
};

export function formatApplicantStage(stage: ApplicantStage): string {
  return stage.charAt(0).toUpperCase() + stage.slice(1);
}

export function allowedApplicantTransitions(
  stage: ApplicantStage,
): ApplicantStage[] {
  return [...TRANSITIONS[stage]];
}

export function assertApplicantTransition(
  from: ApplicantStage,
  to: ApplicantStage,
  context: ApplicantTransitionContext,
): void {
  if (context.convertedEmployeeId) {
    throw new Error("This applicant has already been converted to an employee");
  }
  if (to === "offer") {
    throw new Error(
      "Move candidates to Offer through the offer approval workflow",
    );
  }
  if (to === "hired") {
    throw new Error(
      "Move candidates to Hired through the employee conversion workflow",
    );
  }
  if (to === "rejected" && !context.rejectionReason?.trim()) {
    throw new Error("A rejection reason is required");
  }
  if (!TRANSITIONS[from].includes(to)) {
    throw new Error(
      `Applicant cannot move from ${formatApplicantStage(from)} to ${formatApplicantStage(to)}`,
    );
  }
}

export function getApplicantStageAge(
  applicant: ApplicantStageSnapshot,
  now = Date.now(),
): ApplicantStageAge {
  const latestCurrentStageEvent = applicant.pipelineStageHistory
    .filter((event) => event.to === applicant.status)
    .reduce<
      ApplicantStageEvent | undefined
    >((latest, event) => (!latest || event.changedAt > latest.changedAt ? event : latest), undefined);
  const enteredAt = latestCurrentStageEvent?.changedAt ?? applicant.appliedDate;
  const days = Math.max(0, Math.floor((now - enteredAt) / DAY_IN_MS));
  return { enteredAt, days, isStale: days >= 7 };
}

export function validateScorecard(criteria: readonly ScorecardCriterion[]): {
  overallScore: number;
} {
  if (criteria.length === 0) {
    throw new Error("A scorecard needs at least one criterion");
  }
  for (const criterion of criteria) {
    if (!criterion.label.trim())
      throw new Error("Every criterion needs a label");
    if (
      !Number.isFinite(criterion.score) ||
      criterion.score < 1 ||
      criterion.score > 5
    ) {
      throw new Error("Criterion scores must be between 1 and 5");
    }
  }
  const total = criteria.reduce((sum, criterion) => sum + criterion.score, 0);
  return { overallScore: Math.round((total / criteria.length) * 100) / 100 };
}

export function summarizeRecruitmentPipeline(
  jobs: readonly RecruitmentPositionSnapshot[],
  applicants: readonly RecruitmentApplicantSnapshot[],
  now = Date.now(),
): RecruitmentPipelineSummary {
  const stageCounts = Object.fromEntries(
    APPLICANT_STAGES.map((stage) => [stage, 0]),
  ) as Record<ApplicantStage, number>;
  for (const applicant of applicants) stageCounts[applicant.status] += 1;

  const openJobs = jobs.filter((job) => job.status === "open");
  const openJobIds = new Set(openJobs.map((job) => job.id));
  const plannedOpenings = openJobs.reduce(
    (total, job) => total + job.numberOfOpenings,
    0,
  );
  const hiresForOpenJobs = applicants.filter(
    (applicant) =>
      applicant.status === "hired" && openJobIds.has(applicant.jobId),
  ).length;
  const activeApplicants = applicants.filter(
    (applicant) =>
      applicant.status !== "hired" && applicant.status !== "rejected",
  );

  return {
    activePositions: openJobs.length,
    openHeadcount: Math.max(0, plannedOpenings - hiresForOpenJobs),
    totalApplicants: applicants.length,
    activeCandidates: activeApplicants.length,
    awaitingDecision: applicants.filter(
      (applicant) =>
        applicant.status === "assessment" || applicant.status === "offer",
    ).length,
    staleCandidates: activeApplicants.filter(
      (applicant) => getApplicantStageAge(applicant, now).isStale,
    ).length,
    stageCounts,
  };
}
