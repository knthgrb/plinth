import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { getAuthedConvexClient } from "@/lib/convex-client";

export class AssetsService {
  static async getAssets(organizationId: string) {
    const convex = await getAuthedConvexClient();
    return await (convex.query as any)((api as any).assets.getAssets, {
      organizationId: organizationId as Id<"organizations">,
    });
  }

  static async getAsset(assetId: string) {
    const convex = await getAuthedConvexClient();
    return await (convex.query as any)((api as any).assets.getAsset, {
      assetId: assetId as Id<"assets">,
    });
  }

  static async createAsset(data: {
    organizationId: string;
    name: string;
    description?: string;
    category?: string;
    quantity: number;
    unitPrice?: number;
    totalValue?: number;
    datePurchased?: number;
    supplier?: string;
    serialNumber?: string;
    location?: string;
    status?: "active" | "inactive" | "disposed" | "maintenance";
    notes?: string;
  }) {
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)((api as any).assets.createAsset, {
      ...data,
      organizationId: data.organizationId as Id<"organizations">,
    });
  }

  static async updateAsset(
    assetId: string,
    data: {
      name?: string;
      description?: string;
      category?: string;
      quantity?: number;
      unitPrice?: number;
      totalValue?: number;
      datePurchased?: number;
      supplier?: string;
      serialNumber?: string;
      location?: string;
      status?: "active" | "inactive" | "disposed" | "maintenance";
      notes?: string;
    }
  ) {
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)((api as any).assets.updateAsset, {
      assetId: assetId as Id<"assets">,
      ...data,
    });
  }

  static async deleteAsset(assetId: string) {
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)((api as any).assets.deleteAsset, {
      assetId: assetId as Id<"assets">,
    });
  }
}
