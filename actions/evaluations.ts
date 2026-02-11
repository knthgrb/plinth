"use server";

import { EvaluationService } from "@/services/evaluation-service";

export async function getEvaluations(data: {
  organizationId: string;
  employeeId?: string;
}) {
  return EvaluationService.getEvaluations(data);
}

export async function createEvaluation(data: {
  organizationId: string;
  employeeId: string;
  evaluationDate: number;
  label: string;
  rating?: number;
  frequencyMonths?: number;
  attachmentUrl?: string;
  notes?: string;
}) {
  return EvaluationService.createEvaluation(data);
}

export async function updateEvaluation(data: {
  evaluationId: string;
  label?: string;
  evaluationDate?: number;
  rating?: number;
  frequencyMonths?: number;
  attachmentUrl?: string;
  notes?: string;
}) {
  return EvaluationService.updateEvaluation(data);
}

export async function deleteEvaluation(evaluationId: string) {
  return EvaluationService.deleteEvaluation(evaluationId);
}
