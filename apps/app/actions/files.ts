"use server";

import { FilesService } from "@/services/files-service";

export async function getFileUrl(storageId: string): Promise<string> {
  return FilesService.getFileUrl(storageId);
}

/**
 * Get a presigned URL for an announcement attachment (private to org).
 * Only returns a URL if the user is in the organization and the attachment
 * belongs to that announcement.
 */
export async function getAnnouncementAttachmentUrl(
  organizationId: string,
  announcementId: string,
  storageId: string
): Promise<string> {
  return FilesService.getAnnouncementAttachmentUrl(
    organizationId,
    announcementId,
    storageId
  );
}

export async function generateUploadUrl(): Promise<string> {
  return FilesService.generateUploadUrl();
}
