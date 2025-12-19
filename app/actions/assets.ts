"use server";

import { AssetsService } from "@/services/assets-service";

export async function getAssets(organizationId: string) {
  return AssetsService.getAssets(organizationId);
}

export async function getAsset(assetId: string) {
  return AssetsService.getAsset(assetId);
}

export async function createAsset(data: {
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
  return AssetsService.createAsset(data);
}

export async function updateAsset(
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
  return AssetsService.updateAsset(assetId, data);
}

export async function deleteAsset(assetId: string) {
  return AssetsService.deleteAsset(assetId);
}
