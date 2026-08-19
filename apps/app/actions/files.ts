"use server";

import { FilesService } from "@/services/files-service";
import type { StoragePurpose } from "@/services/files-service";

export async function getFileUrl(
  organizationId: string,
  storageId: string,
): Promise<string> {
  return FilesService.getFileUrl(organizationId, storageId);
}

export async function getDocumentAttachmentUrl(
  organizationId: string,
  documentId: string,
  storageId: string,
  employeeExperienceMode = false,
): Promise<string> {
  return FilesService.getDocumentAttachmentUrl(
    organizationId,
    documentId,
    storageId,
    employeeExperienceMode,
  );
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

export async function createUploadIntent(
  organizationId: string,
  purpose: StoragePurpose,
): Promise<{ uploadUrl: string; intentId: string }> {
  return FilesService.createUploadIntent(organizationId, purpose);
}

export async function registerUploadedFile(
  intentId: string,
  storageId: string,
  metadata?: { fileName?: string },
): Promise<string> {
  return FilesService.registerUploadedFile(intentId, storageId, metadata);
}
