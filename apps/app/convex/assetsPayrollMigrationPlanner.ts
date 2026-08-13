import type {
  AssetCustodyPlan,
  AssetCustodyProjection,
  AssetsPayrollMigrationIssueCode,
  AssetsPayrollProjectionPlan,
} from "./assetsPayrollMigrationTypes";

export const ASSETS_PAYROLL_MIGRATION_KEY = "full-schema-assets-payroll";
export const ASSETS_PAYROLL_MIGRATION_VERSION = 1;

const IGNORED_COMPARISON_FIELDS = new Set([
  "_id",
  "_creationTime",
  "createdAt",
  "updatedAt",
]);

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(
          ([key, child]) =>
            child !== undefined && !IGNORED_COMPARISON_FIELDS.has(key),
        )
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

export function assetsPayrollProjectionsEqual(
  left: unknown,
  right: unknown,
): boolean {
  return (
    JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right))
  );
}

export function planAssetsPayrollProjection<T>(args: {
  expected: T;
  destinations: unknown[];
  duplicateCode: AssetsPayrollMigrationIssueCode;
  mismatchCode: AssetsPayrollMigrationIssueCode;
  field: string;
}): AssetsPayrollProjectionPlan<T> {
  if (args.destinations.length > 1) {
    return {
      outcome: "conflict",
      issues: [{ code: args.duplicateCode, field: args.field }],
    };
  }
  const existing = args.destinations[0];
  if (!existing) return { outcome: "create", value: args.expected };
  if (!assetsPayrollProjectionsEqual(existing, args.expected)) {
    return {
      outcome: "conflict",
      issues: [{ code: args.mismatchCode, field: args.field }],
    };
  }
  return { outcome: "unchanged" };
}

export function buildAssetCustodyEvents(source: {
  assignedEmployeeId?: string;
  assignedAt?: number;
  assignedBy?: string;
  custodyAcknowledgedAt?: number;
  returnDueDate?: number;
  returnedAt?: number;
}): AssetCustodyPlan {
  const issues: AssetsPayrollMigrationIssueCode[] = [];
  if (source.assignedEmployeeId && source.assignedAt === undefined) {
    issues.push("INVALID_ASSET_CUSTODY_STATE");
  }
  if (source.custodyAcknowledgedAt !== undefined && !source.assignedEmployeeId) {
    issues.push("INVALID_ASSET_CUSTODY_STATE");
  }
  if (issues.length > 0) {
    return {
      outcome: "conflict",
      issues: issues.map((code) => ({ code, field: "custody" })),
    };
  }

  const events: AssetCustodyProjection[] = [];
  if (source.assignedEmployeeId && source.assignedAt !== undefined) {
    events.push({
      sourceIndex: 0,
      eventType: "assigned",
      employeeId: source.assignedEmployeeId,
      ...(source.assignedBy ? { actorUserId: source.assignedBy } : {}),
      occurredAt: source.assignedAt,
      ...(source.returnDueDate !== undefined
        ? { returnDueDate: source.returnDueDate }
        : {}),
    });
  }
  if (
    source.assignedEmployeeId &&
    source.custodyAcknowledgedAt !== undefined
  ) {
    events.push({
      sourceIndex: 1,
      eventType: "acknowledged",
      employeeId: source.assignedEmployeeId,
      occurredAt: source.custodyAcknowledgedAt,
    });
  }
  if (source.returnedAt !== undefined) {
    events.push({
      sourceIndex: 2,
      eventType: "returned",
      ...(source.assignedEmployeeId
        ? { employeeId: source.assignedEmployeeId }
        : {}),
      occurredAt: source.returnedAt,
    });
  }
  return { outcome: "valid", events };
}
