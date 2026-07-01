"use server";

import { EvaluationService } from "@/services/evaluation-service";

export async function getEvaluationTemplates(data: { organizationId: string }) {
  return EvaluationService.getEvaluationTemplates(data);
}

export async function createEvaluationTemplate(data: {
  organizationId: string;
  name: string;
  reviewCycle?: string;
  sections: { label: string; weight?: number }[];
  isActive?: boolean;
}) {
  return EvaluationService.createEvaluationTemplate(data);
}

export async function getEvaluations(data: {
  organizationId: string;
  employeeId?: string;
}) {
  return EvaluationService.getEvaluations(data);
}

export async function createEvaluation(data: {
  organizationId: string;
  employeeId: string;
  templateId?: string;
  evaluationDate: number;
  label: string;
  reviewCycle?: string;
  rating?: number;
  frequencyMonths?: number;
  attachmentUrl?: string;
  notes?: string;
  selfReview?: { rating?: number; notes?: string; submittedAt?: number };
  managerReview?: {
    rating?: number;
    notes?: string;
    submittedAt?: number;
    reviewerId?: string;
  };
  assignedReviewerIds?: string[];
}) {
  return EvaluationService.createEvaluation(data);
}

export async function updateEvaluation(data: {
  evaluationId: string;
  templateId?: string;
  label?: string;
  evaluationDate?: number;
  reviewCycle?: string;
  rating?: number;
  frequencyMonths?: number;
  attachmentUrl?: string;
  notes?: string;
  selfReview?: { rating?: number; notes?: string; submittedAt?: number };
  managerReview?: {
    rating?: number;
    notes?: string;
    submittedAt?: number;
    reviewerId?: string;
  };
  assignedReviewerIds?: string[];
}) {
  return EvaluationService.updateEvaluation(data);
}

export async function assignEvaluationReviewers(data: {
  evaluationId: string;
  reviewerIds: string[];
}) {
  return EvaluationService.assignEvaluationReviewers(data);
}

export async function lockEvaluation(evaluationId: string) {
  return EvaluationService.lockEvaluation(evaluationId);
}

export async function deleteEvaluation(evaluationId: string) {
  return EvaluationService.deleteEvaluation(evaluationId);
}
