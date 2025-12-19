import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { getAuthedConvexClient } from "@/lib/convex-client";

export class DocumentsService {
  static async createDocument(data: {
    organizationId: string;
    employeeId?: string;
    title: string;
    content: string;
    type: "personal" | "employment" | "contract" | "certificate" | "other";
    category?: string;
    attachments?: string[];
    isShared?: boolean;
    sharedWith?: string[];
  }) {
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)(
      (api as any).documents.createDocument,
      {
        ...data,
        organizationId: data.organizationId as Id<"organizations">,
        employeeId: data.employeeId as Id<"employees"> | undefined,
        attachments: data.attachments as Id<"_storage">[] | undefined,
        sharedWith: data.sharedWith as Id<"users">[] | undefined,
      }
    );
  }

  static async updateDocument(
    documentId: string,
    data: {
      title?: string;
      content?: string;
      type?: "personal" | "employment" | "contract" | "certificate" | "other";
      category?: string;
      attachments?: string[];
      isShared?: boolean;
      sharedWith?: string[];
    }
  ) {
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)(
      (api as any).documents.updateDocument,
      {
        documentId: documentId as Id<"documents">,
        ...data,
        attachments: data.attachments as Id<"_storage">[] | undefined,
        sharedWith: data.sharedWith as Id<"users">[] | undefined,
      }
    );
  }

  static async deleteDocument(documentId: string) {
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)(
      (api as any).documents.deleteDocument,
      {
        documentId: documentId as Id<"documents">,
      }
    );
  }
}
