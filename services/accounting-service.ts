import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { getAuthedConvexClient } from "@/lib/convex-client";

export class AccountingService {
  static async getCostCategories(organizationId: string) {
    const convex = await getAuthedConvexClient();
    return await (convex.query as any)(
      (api as any).accounting.getCostCategories,
      {
        organizationId: organizationId as Id<"organizations">,
      }
    );
  }

  static async getCostItems(organizationId: string, categoryId?: string) {
    const convex = await getAuthedConvexClient();
    return await (convex.query as any)((api as any).accounting.getCostItems, {
      organizationId: organizationId as Id<"organizations">,
      categoryId: categoryId
        ? (categoryId as Id<"accountingCategories">)
        : undefined,
    });
  }

  static async createCostCategory(data: {
    organizationId: string;
    name: string;
    description?: string;
  }) {
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)(
      (api as any).accounting.createCostCategory,
      {
        organizationId: data.organizationId as Id<"organizations">,
        name: data.name,
        description: data.description,
      }
    );
  }

  static async updateCostCategory(data: {
    categoryId: string;
    name?: string;
    description?: string;
  }) {
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)(
      (api as any).accounting.updateCostCategory,
      {
        categoryId: data.categoryId as Id<"accountingCategories">,
        name: data.name,
        description: data.description,
      }
    );
  }

  static async deleteCostCategory(categoryId: string) {
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)(
      (api as any).accounting.deleteCostCategory,
      {
        categoryId: categoryId as Id<"accountingCategories">,
      }
    );
  }

  static async createCostItem(data: {
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
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)(
      (api as any).accounting.createCostItem,
      {
        organizationId: data.organizationId as Id<"organizations">,
        categoryId: data.categoryId as Id<"accountingCategories">,
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
    categoryId?: string;
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
        categoryId: data.categoryId
          ? (data.categoryId as Id<"accountingCategories">)
          : undefined,
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
