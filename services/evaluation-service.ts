import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { getAuthedConvexClient } from "@/lib/convex-client";

export class EvaluationService {
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
    evaluationDate: number;
    label: string;
    rating?: number;
    frequencyMonths?: number;
    attachmentUrl?: string;
    notes?: string;
  }) {
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)(
      (api as any).evaluations.createEvaluation,
      {
        ...data,
        organizationId: data.organizationId as Id<"organizations">,
        employeeId: data.employeeId as Id<"employees">,
      }
    );
  }

  static async updateEvaluation(data: {
    evaluationId: string;
    label?: string;
    evaluationDate?: number;
    rating?: number;
    frequencyMonths?: number;
    attachmentUrl?: string;
    notes?: string;
  }) {
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)(
      (api as any).evaluations.updateEvaluation,
      {
        evaluationId: data.evaluationId as Id<"evaluations">,
        label: data.label,
        evaluationDate: data.evaluationDate,
        rating: data.rating,
        frequencyMonths: data.frequencyMonths,
        attachmentUrl: data.attachmentUrl,
        notes: data.notes,
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
