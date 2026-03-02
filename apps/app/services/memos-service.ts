import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { getAuthedConvexClient } from "@/lib/convex-client";
import { getToken } from "@/lib/auth-server";

export class MemosService {
  static async createMemo(data: {
    organizationId: string;
    title: string;
    content: string;
    category?: "disciplinary" | "holidays" | "company-policies";
    type: "announcement" | "policy" | "directive" | "notice" | "other";
    priority: "normal" | "important" | "urgent";
    targetAudience: "all" | "department" | "specific-employees";
    departments?: string[];
    specificEmployees?: string[];
    expiryDate?: number;
    attachments?: string[];
    acknowledgementRequired: boolean;
    isPublished: boolean;
  }) {
    const token = await getToken();
    if (!token) throw new Error("Not authenticated");

    const convex = await getAuthedConvexClient();
    return await (convex.action as any)(
      (api as any).memos.createMemo,
      {
        ...data,
        organizationId: data.organizationId as Id<"organizations">,
        specificEmployees: data.specificEmployees as
          | Id<"employees">[]
          | undefined,
        attachments: data.attachments as Id<"_storage">[] | undefined,
      },
      { token }
    );
  }

  static async updateMemo(
    memoId: string,
    data: {
      title?: string;
      content?: string;
      category?: "disciplinary" | "holidays" | "company-policies";
      type?: "announcement" | "policy" | "directive" | "notice" | "other";
      priority?: "normal" | "important" | "urgent";
      targetAudience?: "all" | "department" | "specific-employees";
      departments?: string[];
      specificEmployees?: string[];
      expiryDate?: number;
      attachments?: string[];
      acknowledgementRequired?: boolean;
      isPublished?: boolean;
    }
  ) {
    const token = await getToken();
    if (!token) throw new Error("Not authenticated");

    const convex = await getAuthedConvexClient();
    return await (convex.action as any)(
      (api as any).memos.updateMemo,
      {
        memoId: memoId as Id<"memos">,
        ...data,
        specificEmployees: data.specificEmployees as
          | Id<"employees">[]
          | undefined,
        attachments: data.attachments as Id<"_storage">[] | undefined,
      },
      { token }
    );
  }

  static async deleteMemo(memoId: string) {
    const token = await getToken();
    if (!token) throw new Error("Not authenticated");

    const convex = await getAuthedConvexClient();
    return await (convex.action as any)(
      (api as any).memos.deleteMemo,
      {
        memoId: memoId as Id<"memos">,
      },
      { token }
    );
  }

  static async publishMemo(memoId: string) {
    const token = await getToken();
    if (!token) throw new Error("Not authenticated");

    const convex = await getAuthedConvexClient();
    return await (convex.action as any)(
      (api as any).memos.publishMemo,
      {
        memoId: memoId as Id<"memos">,
      },
      { token }
    );
  }

  static async acknowledgeMemo(memoId: string, employeeId: string) {
    const token = await getToken();
    if (!token) throw new Error("Not authenticated");

    const convex = await getAuthedConvexClient();
    return await (convex.action as any)(
      (api as any).memos.acknowledgeMemo,
      {
        memoId: memoId as Id<"memos">,
        employeeId: employeeId as Id<"employees">,
      },
      { token }
    );
  }

  static async getMemo(memoId: string) {
    const token = await getToken();
    if (!token) throw new Error("Not authenticated");

    const convex = await getAuthedConvexClient();
    return await (convex.query as any)(
      (api as any).memos.getMemo,
      {
        memoId: memoId as Id<"memos">,
      },
      { token }
    );
  }

  static async getMemoTemplates(
    organizationId: string,
    category?: "disciplinary" | "holidays" | "company-policies"
  ) {
    const token = await getToken();
    if (!token) throw new Error("Not authenticated");

    const convex = await getAuthedConvexClient();
    return await (convex.query as any)(
      (api as any).memos.getMemoTemplates,
      {
        organizationId: organizationId as Id<"organizations">,
        category,
      },
      { token }
    );
  }

  static async getMemoTemplate(templateId: string) {
    const token = await getToken();
    if (!token) throw new Error("Not authenticated");

    const convex = await getAuthedConvexClient();
    return await (convex.query as any)(
      (api as any).memos.getMemoTemplate,
      {
        templateId: templateId as Id<"memoTemplates">,
      },
      { token }
    );
  }

  static async createMemoTemplate(data: {
    organizationId: string;
    name: string;
    title: string;
    content: string;
    category: "disciplinary" | "holidays" | "company-policies";
    type: "announcement" | "policy" | "directive" | "notice" | "other";
    priority: "normal" | "important" | "urgent";
  }) {
    const token = await getToken();
    if (!token) throw new Error("Not authenticated");

    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)(
      (api as any).memos.createMemoTemplate,
      {
        ...data,
        organizationId: data.organizationId as Id<"organizations">,
      },
      { token }
    );
  }

  static async updateMemoTemplate(
    templateId: string,
    data: {
      name?: string;
      title?: string;
      content?: string;
      category?: "disciplinary" | "holidays" | "company-policies";
      type?: "announcement" | "policy" | "directive" | "notice" | "other";
      priority?: "normal" | "important" | "urgent";
    }
  ) {
    const token = await getToken();
    if (!token) throw new Error("Not authenticated");

    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)(
      (api as any).memos.updateMemoTemplate,
      {
        templateId: templateId as Id<"memoTemplates">,
        ...data,
      },
      { token }
    );
  }

  static async deleteMemoTemplate(templateId: string) {
    const token = await getToken();
    if (!token) throw new Error("Not authenticated");

    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)(
      (api as any).memos.deleteMemoTemplate,
      {
        templateId: templateId as Id<"memoTemplates">,
      },
      { token }
    );
  }
}
