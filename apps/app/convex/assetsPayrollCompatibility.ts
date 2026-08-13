import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { buildAssetCustodyEvents } from "./assetsPayrollMigrationPlanner";

const MIGRATION_VERSION = 1;
type DatabaseContext = Pick<QueryCtx | MutationCtx, "db">;
type PayrollNotes = NonNullable<Doc<"payrollRuns">["notes"]>;

export async function loadEffectiveAsset(
  ctx: DatabaseContext,
  asset: Doc<"assets">,
): Promise<Doc<"assets">> {
  const [maintenance, custody] = await Promise.all([
    ctx.db.query("assetMaintenanceEvents").withIndex("by_asset_source", (q) => q.eq("assetId", asset._id)).collect(),
    ctx.db.query("assetCustodyEvents").withIndex("by_asset_source", (q) => q.eq("assetId", asset._id)).collect(),
  ]);
  for (const row of [...maintenance, ...custody]) {
    if (row.organizationId !== asset.organizationId || row.assetId !== asset._id) {
      throw new Error("Asset event tenant mismatch");
    }
  }
  const maintenanceHistory = maintenance
    .slice()
    .sort((a, b) => a.sourceIndex - b.sourceIndex)
    .map((row) => ({
      date: row.serviceDate,
      description: row.description,
      ...(row.cost !== undefined ? { cost: row.cost } : {}),
      ...(row.performedBy !== undefined ? { performedBy: row.performedBy } : {}),
      ...(row.nextServiceDate !== undefined
        ? { nextServiceDate: row.nextServiceDate }
        : {}),
    }));
  const assigned = custody.find((row) => row.eventType === "assigned");
  const acknowledged = custody.find((row) => row.eventType === "acknowledged");
  const returned = custody.find((row) => row.eventType === "returned");
  return {
    ...asset,
    maintenanceHistory:
      maintenance.length > 0 ? maintenanceHistory : asset.maintenanceHistory,
    ...(custody.length > 0
      ? {
          assignedEmployeeId: assigned?.employeeId,
          assignedAt: assigned?.occurredAt,
          assignedBy: assigned?.actorUserId,
          returnDueDate: assigned?.returnDueDate,
          custodyAcknowledgedAt: acknowledged?.occurredAt,
          returnedAt: returned?.occurredAt,
        }
      : {}),
  };
}

export async function replaceAssetProjection(
  ctx: MutationCtx,
  asset: Doc<"assets">,
  effective: Pick<
    Doc<"assets">,
    | "assignedEmployeeId"
    | "assignedAt"
    | "assignedBy"
    | "custodyAcknowledgedAt"
    | "returnDueDate"
    | "returnedAt"
    | "maintenanceHistory"
  >,
  now: number,
): Promise<void> {
  const [maintenance, custody] = await Promise.all([
    ctx.db.query("assetMaintenanceEvents").withIndex("by_asset_source", (q) => q.eq("assetId", asset._id)).collect(),
    ctx.db.query("assetCustodyEvents").withIndex("by_asset_source", (q) => q.eq("assetId", asset._id)).collect(),
  ]);
  for (const row of [...maintenance, ...custody]) await ctx.db.delete(row._id);
  const custodyPlan = buildAssetCustodyEvents(effective);
  if (custodyPlan.outcome === "conflict") {
    throw new Error("Invalid asset custody state");
  }
  for (const event of custodyPlan.events) {
    await ctx.db.insert("assetCustodyEvents", {
      organizationId: asset.organizationId,
      assetId: asset._id,
      eventType: event.eventType,
      ...(event.employeeId ? { employeeId: event.employeeId as Id<"employees"> } : {}),
      ...(event.actorUserId ? { actorUserId: event.actorUserId as Id<"users"> } : {}),
      occurredAt: event.occurredAt,
      ...(event.returnDueDate !== undefined
        ? { returnDueDate: event.returnDueDate }
        : {}),
      sourceIndex: event.sourceIndex,
      migrationVersion: MIGRATION_VERSION,
      createdAt: now,
      updatedAt: now,
    });
  }
  for (const [sourceIndex, entry] of (effective.maintenanceHistory ?? []).entries()) {
    await ctx.db.insert("assetMaintenanceEvents", {
      organizationId: asset.organizationId,
      assetId: asset._id,
      serviceDate: entry.date,
      description: entry.description,
      ...(entry.cost !== undefined ? { cost: entry.cost } : {}),
      ...(entry.performedBy !== undefined ? { performedBy: entry.performedBy } : {}),
      ...(entry.nextServiceDate !== undefined ? { nextServiceDate: entry.nextServiceDate } : {}),
      sourceIndex,
      migrationVersion: MIGRATION_VERSION,
      createdAt: now,
      updatedAt: now,
    });
  }
}

export async function loadEffectivePayrollRunNotes(
  ctx: DatabaseContext,
  payrollRun: Doc<"payrollRuns">,
): Promise<PayrollNotes> {
  const rows = await ctx.db
    .query("payrollRunNotes")
    .withIndex("by_payroll_run", (q) => q.eq("payrollRunId", payrollRun._id))
    .collect();
  if (rows.length === 0) return payrollRun.notes ?? [];
  return rows
    .sort((a, b) => a.sourceIndex - b.sourceIndex)
    .map((row) => {
      if (row.organizationId !== payrollRun.organizationId) {
        throw new Error("Payroll note tenant mismatch");
      }
      return {
        employeeId: row.employeeId,
        date: row.noteDate,
        note: row.note,
        addedBy: row.addedBy,
        addedAt: row.addedAt,
      };
    });
}

export async function replacePayrollRunNotes(
  ctx: MutationCtx,
  payrollRun: Doc<"payrollRuns">,
  notes: PayrollNotes,
  now: number,
): Promise<void> {
  const existing = await ctx.db.query("payrollRunNotes").withIndex("by_payroll_run", (q) => q.eq("payrollRunId", payrollRun._id)).collect();
  for (const row of existing) await ctx.db.delete(row._id);
  for (const [sourceIndex, note] of notes.entries()) {
    await ctx.db.insert("payrollRunNotes", { organizationId: payrollRun.organizationId, payrollRunId: payrollRun._id, employeeId: note.employeeId, noteDate: note.date, note: note.note, addedBy: note.addedBy, addedAt: note.addedAt, sourceIndex, migrationVersion: MIGRATION_VERSION, createdAt: now, updatedAt: now });
  }
}

export async function loadEffectiveAccountingReceipts(
  ctx: DatabaseContext,
  item: Doc<"accountingCostItems">,
): Promise<Id<"_storage">[]> {
  const rows = await ctx.db.query("storageObjectLinks").withIndex("by_parent", (q) => q.eq("parentType", "accounting_cost_item").eq("parentId", item._id)).collect();
  if (rows.length === 0) return item.receipts ?? [];
  return rows.sort((a, b) => a.sourceIndex - b.sourceIndex).map((row) => {
    if (row.organizationId !== item.organizationId || row.purpose !== "accounting_receipt") throw new Error("Accounting receipt tenant mismatch");
    return row.storageId;
  });
}

export async function replaceAccountingReceipts(
  ctx: MutationCtx,
  item: Doc<"accountingCostItems">,
  receipts: Id<"_storage">[],
  now: number,
): Promise<void> {
  const existing = await ctx.db.query("storageObjectLinks").withIndex("by_parent", (q) => q.eq("parentType", "accounting_cost_item").eq("parentId", item._id)).collect();
  for (const row of existing) await ctx.db.delete(row._id);
  const storageIds = new Set<Id<"_storage">>();
  for (const [sourceIndex, storageId] of receipts.entries()) {
    if (storageIds.has(storageId)) throw new Error("Accounting receipt is not unique");
    storageIds.add(storageId);
    await ctx.db.insert("storageObjectLinks", { organizationId: item.organizationId, storageId, parentType: "accounting_cost_item", parentId: item._id, purpose: "accounting_receipt", sourceIndex, migrationVersion: MIGRATION_VERSION, createdAt: now, updatedAt: now });
  }
}
