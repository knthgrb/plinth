"use server";

import { DocumentsService } from "@/services/documents-service";

type DocumentVisibilityScope =
  | "admins_only"
  | "all_employees"
  | "department"
  | "specific_employee"
  | "alumni_visible"
  | "payroll_visible";

export async function createDocument(data: {
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
  return DocumentsService.createDocument(data);
}

export async function updateDocument(
  documentId: string,
  data: {
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
  return DocumentsService.updateDocument(documentId, data);
}

export async function deleteDocument(documentId: string) {
  return DocumentsService.deleteDocument(documentId);
}
