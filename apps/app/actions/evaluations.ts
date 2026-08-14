"use server";

import type {
  CompleteEvaluationInput,
  ScheduleEvaluationInput,
  UpdateScheduledEvaluationInput,
} from "@/lib/evaluations/types";
import { EvaluationService } from "@/services/evaluation-service";

export async function getEvaluationWorkspace(organizationId: string) {
  return EvaluationService.getEvaluationWorkspace(organizationId);
}

export async function scheduleEvaluation(data: ScheduleEvaluationInput) {
  return EvaluationService.scheduleEvaluation(data);
}

export async function updateScheduledEvaluation(
  data: UpdateScheduledEvaluationInput,
) {
  return EvaluationService.updateScheduledEvaluation(data);
}

export async function completeEvaluation(data: CompleteEvaluationInput) {
  return EvaluationService.completeEvaluation(data);
}

export async function cancelEvaluation(
  evaluationId: string,
  reason: string,
) {
  return EvaluationService.cancelEvaluation(evaluationId, reason);
}

export async function setEvaluationScheduleActive(
  scheduleId: string,
  isActive: boolean,
) {
  return EvaluationService.setEvaluationScheduleActive(scheduleId, isActive);
}

export async function getEvaluationAttachmentUrl(
  evaluationId: string,
  storageId: string,
) {
  return EvaluationService.getEvaluationAttachmentUrl(evaluationId, storageId);
}
