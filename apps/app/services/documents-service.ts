import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { getAuthedConvexClient } from "@/lib/convex-client";

type DocumentVisibilityScope =
  | "admins_only"
  | "all_employees"
  | "department"
  | "specific_employee"
  | "alumni_visible"
  | "payroll_visible";

export class DocumentsService {
  static async createDocument(data: {
    organizationId: string;
    employeeId?: string;
    title: string;
    content: string;
    type:
      | "personal"
      | "employment"
      | "contract"
      | "certificate"
      | "leave_form"
      | "other";
    category?: string;
    attachments?: string[];
    isShared?: boolean;
    sharedWith?: string[];
    visibilityScope?: DocumentVisibilityScope;
    visibleDepartments?: string[];
    visibleEmployeeIds?: string[];
  }) {
    const convex = await getAuthedConvexClient();
    return await convex.mutation(api.documents.createDocument, {
      ...data,
      organizationId: data.organizationId as Id<"organizations">,
      employeeId: data.employeeId as Id<"employees"> | undefined,
      attachments: data.attachments as Id<"_storage">[] | undefined,
      sharedWith: data.sharedWith as Id<"users">[] | undefined,
      visibleEmployeeIds: data.visibleEmployeeIds as
        | Id<"employees">[]
        | undefined,
    });
  }

  static async updateDocument(
    documentId: string,
    data: {
      employeeId?: string | null;
      title?: string;
      content?: string;
      type?:
        | "personal"
        | "employment"
        | "contract"
        | "certificate"
        | "leave_form"
        | "other";
      category?: string;
      attachments?: string[];
      isShared?: boolean;
      sharedWith?: string[];
      visibilityScope?: DocumentVisibilityScope;
      visibleDepartments?: string[];
      visibleEmployeeIds?: string[];
    }
  ) {
    const convex = await getAuthedConvexClient();
    return await convex.mutation(api.documents.updateDocument, {
      documentId: documentId as Id<"documents">,
      ...data,
      employeeId: data.employeeId as Id<"employees"> | null | undefined,
      attachments: data.attachments as Id<"_storage">[] | undefined,
      sharedWith: data.sharedWith as Id<"users">[] | undefined,
      visibleEmployeeIds: data.visibleEmployeeIds as
        | Id<"employees">[]
        | undefined,
    });
  }

  static async deleteDocument(documentId: string) {
    const convex = await getAuthedConvexClient();
    return await convex.mutation(api.documents.deleteDocument, {
      documentId: documentId as Id<"documents">,
    });
  }
}
