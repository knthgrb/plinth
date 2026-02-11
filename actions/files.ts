"use server";

import { FilesService } from "@/services/files-service";

export async function getFileUrl(storageId: string): Promise<string> {
  return FilesService.getFileUrl(storageId);
}

export async function generateUploadUrl(): Promise<string> {
  return FilesService.generateUploadUrl();
}
