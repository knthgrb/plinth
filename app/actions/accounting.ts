"use server";

import { AccountingService } from "@/services/accounting-service";

export async function getCostCategories(organizationId: string) {
  return AccountingService.getCostCategories(organizationId);
}

export async function getCostItems(
  organizationId: string,
  categoryId?: string
) {
  return AccountingService.getCostItems(organizationId, categoryId);
}

export async function createCostCategory(data: {
  organizationId: string;
  name: string;
  description?: string;
}) {
  return AccountingService.createCostCategory(data);
}

export async function updateCostCategory(data: {
  categoryId: string;
  name?: string;
  description?: string;
}) {
  return AccountingService.updateCostCategory(data);
}

export async function deleteCostCategory(categoryId: string) {
  return AccountingService.deleteCostCategory(categoryId);
}

export async function createCostItem(data: {
  organizationId: string;
  categoryId: string;
  name: string;
  description?: string;
  amount: number;
  amountPaid?: number;
  frequency: "one-time" | "daily" | "weekly" | "monthly" | "yearly";
  status?: "pending" | "partial" | "paid" | "overdue";
  dueDate?: number;
  notes?: string;
  receipts?: string[];
}) {
  return AccountingService.createCostItem(data);
}

export async function updateCostItem(data: {
  itemId: string;
  name?: string;
  description?: string;
  amount?: number;
  amountPaid?: number;
  frequency?: "one-time" | "daily" | "weekly" | "monthly" | "yearly";
  status?: "pending" | "partial" | "paid" | "overdue";
  dueDate?: number;
  notes?: string;
  receipts?: string[];
  categoryId?: string;
}) {
  return AccountingService.updateCostItem(data);
}

export async function deleteCostItem(itemId: string) {
  return AccountingService.deleteCostItem(itemId);
}
