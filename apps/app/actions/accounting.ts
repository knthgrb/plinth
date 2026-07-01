"use server";

import { AccountingService } from "@/services/accounting-service";

export async function getCostItems(
  organizationId: string,
  categoryName?: string
) {
  return AccountingService.getCostItems(organizationId, categoryName);
}

export async function findPayrollAccountingDrift(organizationId: string) {
  return AccountingService.findPayrollAccountingDrift(organizationId);
}

export async function repairPayrollAccounting(data: {
  organizationId: string;
  payrollRunId?: string;
}) {
  return AccountingService.repairPayrollAccounting(data);
}

export async function createCostItem(data: {
  organizationId: string;
  categoryName: string;
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
  categoryName?: string;
}) {
  return AccountingService.updateCostItem(data);
}

export async function deleteCostItem(itemId: string) {
  return AccountingService.deleteCostItem(itemId);
}
