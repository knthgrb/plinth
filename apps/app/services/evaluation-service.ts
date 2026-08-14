import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type {
  CompleteEvaluationInput,
  ScheduleEvaluationInput,
  UpdateScheduledEvaluationInput,
} from "@/lib/evaluations/types";
import { getAuthedConvexClient } from "@/lib/convex-client";

export class EvaluationService {
  static async getEvaluationWorkspace(organizationId: string) {
    const convex = await getAuthedConvexClient();
    return convex.query(api.evaluations.getEvaluationWorkspace, {
      organizationId: organizationId as Id<"organizations">,
    });
  }

  static async scheduleEvaluation(data: ScheduleEvaluationInput) {
    const convex = await getAuthedConvexClient();
    return convex.mutation(api.evaluations.scheduleEvaluation, {
      organizationId: data.organizationId as Id<"organizations">,
      employeeId: data.employeeId as Id<"employees">,
      templateId: data.templateId as Id<"evaluationTemplates"> | undefined,
      title: data.title,
      scheduledFor: data.scheduledFor,
      cadence: data.cadence,
      reviewerIds: data.reviewerIds as Id<"users">[] | undefined,
    });
  }

  static async updateScheduledEvaluation(
    data: UpdateScheduledEvaluationInput,
  ) {
    const convex = await getAuthedConvexClient();
    return convex.mutation(api.evaluations.updateScheduledEvaluation, {
      evaluationId: data.evaluationId as Id<"evaluations">,
      title: data.title,
      scheduledFor: data.scheduledFor,
      templateId: data.templateId as Id<"evaluationTemplates"> | undefined,
      reviewerIds: data.reviewerIds as Id<"users">[] | undefined,
    });
  }

  static async completeEvaluation(data: CompleteEvaluationInput) {
    const convex = await getAuthedConvexClient();
    return convex.mutation(api.evaluations.completeEvaluation, {
      evaluationId: data.evaluationId as Id<"evaluations">,
      completedAt: data.completedAt,
      rating: data.rating,
      notes: data.notes,
      outcome: data.outcome,
      followUpDate: data.followUpDate,
      attachmentIds: data.attachmentIds as Id<"_storage">[] | undefined,
    });
  }

  static async cancelEvaluation(evaluationId: string, reason: string) {
    const convex = await getAuthedConvexClient();
    return convex.mutation(api.evaluations.cancelEvaluation, {
      evaluationId: evaluationId as Id<"evaluations">,
      reason,
    });
  }

  static async setEvaluationScheduleActive(
    scheduleId: string,
    isActive: boolean,
  ) {
    const convex = await getAuthedConvexClient();
    return convex.mutation(api.evaluations.setEvaluationScheduleActive, {
      scheduleId: scheduleId as Id<"evaluationSchedules">,
      isActive,
    });
  }

  static async getEvaluationAttachmentUrl(
    evaluationId: string,
    storageId: string,
  ): Promise<string> {
    const convex = await getAuthedConvexClient();
    const url = await convex.query(api.evaluations.getEvaluationAttachmentUrl, {
      evaluationId: evaluationId as Id<"evaluations">,
      storageId: storageId as Id<"_storage">,
    });
    if (!url) throw new Error("Evaluation attachment is unavailable");
    return url;
  }
}
