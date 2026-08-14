import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { EvaluationCadence } from "./workflow";

export type EvaluationOutcome =
  | "exceeds_expectations"
  | "meets_expectations"
  | "partially_meets_expectations"
  | "does_not_meet_expectations";

export type EvaluationWorkspace = FunctionReturnType<
  typeof api.evaluations.getEvaluationWorkspace
>;

export type EvaluationWorkspaceEmployee = EvaluationWorkspace["employees"][number];
export type EvaluationRecord = EvaluationWorkspace["evaluations"][number];
export type EvaluationScheduleRecord = EvaluationWorkspace["schedules"][number];

export type ScheduleEvaluationInput = {
  organizationId: string;
  employeeId: string;
  templateId?: string;
  title: string;
  scheduledFor: number;
  cadence: EvaluationCadence;
  reviewerIds?: string[];
};

export type UpdateScheduledEvaluationInput = {
  evaluationId: string;
  title?: string;
  scheduledFor?: number;
  templateId?: string;
  reviewerIds?: string[];
};

export type CompleteEvaluationInput = {
  evaluationId: string;
  completedAt: number;
  rating?: number;
  notes?: string;
  outcome?: EvaluationOutcome;
  followUpDate?: number;
  attachmentIds?: string[];
};
