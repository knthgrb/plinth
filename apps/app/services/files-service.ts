import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { getAuthedConvexClient } from "@/lib/convex-client";

export type StoragePurpose =
  | "accounting_receipt"
  | "announcement_attachment"
  | "applicant_resume"
  | "chat_attachment"
  | "document_attachment"
  | "employee_requirement"
  | "evaluation_attachment"
  | "government_remittance_evidence"
  | "leave_attachment"
  | "memo_attachment"
  | "payslip_pdf";

export class FilesService {
  static async getFileUrl(
    organizationId: string,
    storageId: string,
  ): Promise<string> {
    const convex = await getAuthedConvexClient();
    const url = await convex.query(api.files.getFileUrl, {
      organizationId: organizationId as Id<"organizations">,
      storageId: storageId as Id<"_storage">,
    });
    if (!url) throw new Error("File is unavailable");
    return url;
  }

  static async getDocumentAttachmentUrl(
    organizationId: string,
    documentId: string,
    storageId: string,
    employeeExperienceMode = false,
  ): Promise<string> {
    const convex = await getAuthedConvexClient();
    const url = await convex.query(api.documents.getDocumentAttachmentUrl, {
      organizationId: organizationId as Id<"organizations">,
      documentId: documentId as Id<"documents">,
      storageId: storageId as Id<"_storage">,
      employeeExperienceMode,
    });
    if (!url) throw new Error("File is unavailable");
    return url;
  }

  /**
   * Get a presigned URL for an announcement attachment. Only succeeds if the user
   * is in the org and the attachment belongs to that announcement (private to org).
   */
  static async getAnnouncementAttachmentUrl(
    organizationId: string,
    announcementId: string,
    storageId: string
  ): Promise<string> {
    const convex = await getAuthedConvexClient();
    const url = await convex.query(
      api.announcements.getAnnouncementAttachmentUrl,
      {
        organizationId: organizationId as Id<"organizations">,
        announcementId: announcementId as Id<"memos">,
        storageId: storageId as Id<"_storage">,
      },
    );
    if (!url) throw new Error("File is unavailable");
    return url;
  }

  static async createUploadIntent(
    organizationId: string,
    purpose: StoragePurpose,
  ): Promise<{ uploadUrl: string; intentId: string }> {
    const convex = await getAuthedConvexClient();
    const intent = await convex.mutation(api.files.createUploadIntent, {
      organizationId: organizationId as Id<"organizations">,
      purpose,
    });
    return { ...intent, intentId: String(intent.intentId) };
  }

  static async registerUploadedFile(
    intentId: string,
    storageId: string,
    metadata?: { fileName?: string },
  ): Promise<string> {
    const convex = await getAuthedConvexClient();
    const storageObjectId = await convex.mutation(
      api.files.registerUploadedFile,
      {
        intentId: intentId as Id<"storageUploadIntents">,
        storageId: storageId as Id<"_storage">,
        ...metadata,
      },
    );
    return String(storageObjectId);
  }
}
