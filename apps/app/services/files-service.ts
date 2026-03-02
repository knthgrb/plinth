import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { getAuthedConvexClient } from "@/lib/convex-client";

export class FilesService {
  static async getFileUrl(storageId: string): Promise<string> {
    const convex = await getAuthedConvexClient();
    return await (convex.query as any)((api as any).files.getFileUrl, {
      storageId: storageId as Id<"_storage">,
    });
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
    return await (convex.query as any)(
      (api as any).announcements.getAnnouncementAttachmentUrl,
      {
        organizationId: organizationId as Id<"organizations">,
        announcementId: announcementId as Id<"memos">,
        storageId: storageId as Id<"_storage">,
      }
    );
  }

  static async generateUploadUrl(): Promise<string> {
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)((api as any).files.generateUploadUrl);
  }
}
