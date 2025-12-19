"use server";

import { MemosService } from "@/services/memos-service";

export async function createMemo(data: {
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
  return MemosService.createMemo(data);
}

export async function updateMemo(
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
  return MemosService.updateMemo(memoId, data);
}

export async function deleteMemo(memoId: string) {
  return MemosService.deleteMemo(memoId);
}

export async function publishMemo(memoId: string) {
  return MemosService.publishMemo(memoId);
}

export async function acknowledgeMemo(memoId: string, employeeId: string) {
  return MemosService.acknowledgeMemo(memoId, employeeId);
}

export async function getMemo(memoId: string) {
  return MemosService.getMemo(memoId);
}

export async function getMemoTemplates(
  organizationId: string,
  category?: "disciplinary" | "holidays" | "company-policies"
) {
  return MemosService.getMemoTemplates(organizationId, category);
}

export async function getMemoTemplate(templateId: string) {
  return MemosService.getMemoTemplate(templateId);
}

export async function createMemoTemplate(data: {
  organizationId: string;
  name: string;
  title: string;
  content: string;
  category: "disciplinary" | "holidays" | "company-policies";
  type: "announcement" | "policy" | "directive" | "notice" | "other";
  priority: "normal" | "important" | "urgent";
}) {
  return MemosService.createMemoTemplate(data);
}

export async function updateMemoTemplate(
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
  return MemosService.updateMemoTemplate(templateId, data);
}

export async function deleteMemoTemplate(templateId: string) {
  return MemosService.deleteMemoTemplate(templateId);
}
