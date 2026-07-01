"use server";

import { AssetsService } from "@/services/assets-service";

type AssetCondition = "new" | "good" | "fair" | "needs_repair" | "damaged";

type AssetMaintenanceEntry = {
  date: number;
  description: string;
  cost?: number;
  performedBy?: string;
  nextServiceDate?: number;
};

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
  assignedEmployeeId?: string | null;
  custodyAcknowledgedAt?: number | null;
  returnDueDate?: number | null;
  returnedAt?: number | null;
  condition?: AssetCondition;
  maintenanceHistory?: AssetMaintenanceEntry[];
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
    assignedEmployeeId?: string | null;
    custodyAcknowledgedAt?: number | null;
    returnDueDate?: number | null;
    returnedAt?: number | null;
    condition?: AssetCondition;
    maintenanceHistory?: AssetMaintenanceEntry[];
    status?: "active" | "inactive" | "disposed" | "maintenance";
    notes?: string;
  }
) {
  return AssetsService.updateAsset(assetId, data);
}

export async function deleteAsset(assetId: string) {
  return AssetsService.deleteAsset(assetId);
}
