import type {
  CustomFieldProjection,
  CustomFieldValueType,
  LeaveBalanceProjection,
  LeaveEmployeeMigrationIssue,
  LeaveEmployeeMigrationIssueCode,
  ProjectionPlan,
} from "./leaveEmployeeMigrationTypes";

export const LEAVE_EMPLOYEE_MIGRATION_KEY =
  "full-schema-leave-employee-children";
export const LEAVE_EMPLOYEE_MIGRATION_VERSION = 1;

export function normalizeMigrationSourceKey(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "unnamed";
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

export function projectionsEqual(left: unknown, right: unknown): boolean {
  return (
    JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right))
  );
}

export function planUniqueProjection<T>(args: {
  expected: T;
  destinations: T[];
  mismatchCode: LeaveEmployeeMigrationIssueCode;
  duplicateCode: LeaveEmployeeMigrationIssueCode;
  field: string;
}): ProjectionPlan<T> {
  if (args.destinations.length > 1) {
    return {
      outcome: "conflict",
      issues: [{ code: args.duplicateCode, field: args.field }],
    };
  }
  const existing = args.destinations[0];
  if (!existing) return { outcome: "create", value: args.expected };
  if (!projectionsEqual(existing, args.expected)) {
    return {
      outcome: "conflict",
      issues: [{ code: args.mismatchCode, field: args.field }],
    };
  }
  return { outcome: "unchanged" };
}

export function planLeaveBalance(args: {
  expected: LeaveBalanceProjection;
  destinations: LeaveBalanceProjection[];
  reconcileUsage: boolean;
}): ProjectionPlan<LeaveBalanceProjection> {
  if (
    args.reconcileUsage &&
    args.expected.reconciliationStatus === "mismatched"
  ) {
    return {
      outcome: "conflict",
      issues: [
        {
          code: "LEAVE_BALANCE_RECONCILIATION_MISMATCH",
          field: "used",
        },
      ],
    };
  }
  return planUniqueProjection({
    expected: args.expected,
    destinations: args.destinations,
    mismatchCode: "LEAVE_BALANCE_MISMATCH",
    duplicateCode: "DUPLICATE_LEAVE_BALANCE",
    field: "leaveTypeKey",
  });
}

export function reconcileLeaveCreditUsage(args: {
  mode: "general" | "by_type";
  credits: Array<{ key: string; used: number }>;
  approvedDays: ReadonlyMap<string, number>;
  generalKey: string;
}): LeaveEmployeeMigrationIssue[] {
  const mismatch = (): LeaveEmployeeMigrationIssue[] => [
    {
      code: "LEAVE_BALANCE_RECONCILIATION_MISMATCH",
      field: "used",
    },
  ];
  if (args.mode === "by_type") {
    return args.credits.some(
      (credit) => credit.used !== (args.approvedDays.get(credit.key) ?? 0),
    )
      ? mismatch()
      : [];
  }

  const pooledKeys = new Set(["vacation", "sick", args.generalKey]);
  const pooledUsed = args.credits
    .filter((credit) => credit.key === "vacation" || credit.key === "sick")
    .reduce((total, credit) => total + credit.used, 0);
  const pooledApproved = [...pooledKeys].reduce(
    (total, key) => total + (args.approvedDays.get(key) ?? 0),
    0,
  );
  if (pooledUsed !== pooledApproved) return mismatch();

  return args.credits
    .filter((credit) => !pooledKeys.has(credit.key))
    .some((credit) => credit.used !== (args.approvedDays.get(credit.key) ?? 0))
    ? mismatch()
    : [];
}

function customFieldValueType(value: unknown): CustomFieldValueType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  switch (typeof value) {
    case "string":
      return "string";
    case "number":
      if (!Number.isFinite(value)) break;
      return "number";
    case "boolean":
      return "boolean";
    case "object":
      return "object";
  }
  throw new Error("Unsupported custom field value");
}

export function buildCustomFieldProjection(
  sourceKey: string,
  value: unknown,
): CustomFieldProjection {
  const valueType = customFieldValueType(value);
  const valueJson = JSON.stringify(canonicalize(value));
  if (valueJson === undefined) {
    throw new Error("Unsupported custom field value");
  }
  return { sourceKey, label: sourceKey, valueType, valueJson };
}
