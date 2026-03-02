"use server";

import { DocumentsService } from "@/services/documents-service";

export async function createDocument(data: {
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
  return DocumentsService.createDocument(data);
}

export async function updateDocument(
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
  return DocumentsService.updateDocument(documentId, data);
}

export async function deleteDocument(documentId: string) {
  return DocumentsService.deleteDocument(documentId);
}
