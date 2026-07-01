import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { getAuthedConvexClient } from "@/lib/convex-client";

export class EvaluationService {
  static async getEvaluationTemplates(params: { organizationId: string }) {
    const convex = await getAuthedConvexClient();
    return await (convex.query as any)(
      (api as any).evaluations.getEvaluationTemplates,
      {
        organizationId: params.organizationId as Id<"organizations">,
      }
    );
  }

  static async createEvaluationTemplate(data: {
    organizationId: string;
    name: string;
    reviewCycle?: string;
    sections: { label: string; weight?: number }[];
    isActive?: boolean;
  }) {
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)(
      (api as any).evaluations.createEvaluationTemplate,
      {
        ...data,
        organizationId: data.organizationId as Id<"organizations">,
      }
    );
  }

  static async getEvaluations(params: {
    organizationId: string;
    employeeId?: string;
  }) {
    const convex = await getAuthedConvexClient();
    return await (convex.query as any)(
      (api as any).evaluations.getEvaluations,
      {
        organizationId: params.organizationId as Id<"organizations">,
        employeeId: params.employeeId as Id<"employees"> | undefined,
      }
    );
  }

  static async createEvaluation(data: {
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
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)(
      (api as any).evaluations.createEvaluation,
      {
        ...data,
        organizationId: data.organizationId as Id<"organizations">,
        employeeId: data.employeeId as Id<"employees">,
        templateId: data.templateId as Id<"evaluationTemplates"> | undefined,
        managerReview: data.managerReview
          ? {
              ...data.managerReview,
              reviewerId: data.managerReview
                .reviewerId as Id<"users"> | undefined,
            }
          : undefined,
        assignedReviewerIds: data.assignedReviewerIds as
          | Id<"users">[]
          | undefined,
      }
    );
  }

  static async updateEvaluation(data: {
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
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)(
      (api as any).evaluations.updateEvaluation,
      {
        evaluationId: data.evaluationId as Id<"evaluations">,
        templateId: data.templateId as Id<"evaluationTemplates"> | undefined,
        label: data.label,
        evaluationDate: data.evaluationDate,
        reviewCycle: data.reviewCycle,
        rating: data.rating,
        frequencyMonths: data.frequencyMonths,
        attachmentUrl: data.attachmentUrl,
        notes: data.notes,
        selfReview: data.selfReview,
        managerReview: data.managerReview
          ? {
              ...data.managerReview,
              reviewerId: data.managerReview
                .reviewerId as Id<"users"> | undefined,
            }
          : undefined,
        assignedReviewerIds: data.assignedReviewerIds as
          | Id<"users">[]
          | undefined,
      }
    );
  }

  static async assignEvaluationReviewers(data: {
    evaluationId: string;
    reviewerIds: string[];
  }) {
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)(
      (api as any).evaluations.assignEvaluationReviewers,
      {
        evaluationId: data.evaluationId as Id<"evaluations">,
        reviewerIds: data.reviewerIds as Id<"users">[],
      }
    );
  }

  static async lockEvaluation(evaluationId: string) {
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)(
      (api as any).evaluations.lockEvaluation,
      {
        evaluationId: evaluationId as Id<"evaluations">,
      }
    );
  }

  static async deleteEvaluation(evaluationId: string) {
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)(
      (api as any).evaluations.deleteEvaluation,
      {
        evaluationId: evaluationId as Id<"evaluations">,
      }
    );
  }
}
