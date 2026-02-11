import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { getAuthedConvexClient } from "@/lib/convex-client";

export class AccountingService {
  static async getCostItems(organizationId: string, categoryName?: string) {
    const convex = await getAuthedConvexClient();
    return await (convex.query as any)((api as any).accounting.getCostItems, {
      organizationId: organizationId as Id<"organizations">,
      categoryName,
    });
  }

  static async createCostItem(data: {
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
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)(
      (api as any).accounting.createCostItem,
      {
        organizationId: data.organizationId as Id<"organizations">,
        categoryName: data.categoryName,
        name: data.name,
        description: data.description,
        amount: data.amount,
        amountPaid: data.amountPaid,
        frequency: data.frequency,
        status: data.status,
        dueDate: data.dueDate,
        notes: data.notes,
        receipts: data.receipts?.map((id) => id as Id<"_storage">),
      }
    );
  }

  static async updateCostItem(data: {
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
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)(
      (api as any).accounting.updateCostItem,
      {
        itemId: data.itemId as Id<"accountingCostItems">,
        name: data.name,
        description: data.description,
        amount: data.amount,
        amountPaid: data.amountPaid,
        frequency: data.frequency,
        status: data.status,
        dueDate: data.dueDate,
        notes: data.notes,
        receipts: data.receipts?.map((id) => id as Id<"_storage">),
        categoryName: data.categoryName,
      }
    );
  }

  static async deleteCostItem(itemId: string) {
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)(
      (api as any).accounting.deleteCostItem,
      {
        itemId: itemId as Id<"accountingCostItems">,
      }
    );
  }
}
