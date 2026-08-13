import type {
  WorkflowCustomValue,
  WorkflowCustomValueType,
  WorkflowMigrationIssueCode,
  WorkflowProjectionPlan,
} from "./workflowMigrationTypes";

export const WORKFLOW_MIGRATION_KEY = "full-schema-workflow-events";
export const WORKFLOW_MIGRATION_VERSION = 1;

export function normalizeWorkflowSourceKey(value: string): string {
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

export function workflowProjectionsEqual(
  left: unknown,
  right: unknown,
): boolean {
  return (
    JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right))
  );
}

export function planWorkflowProjection<T>(args: {
  expected: T;
  destinations: T[];
  duplicateCode: WorkflowMigrationIssueCode;
  mismatchCode: WorkflowMigrationIssueCode;
  field: string;
}): WorkflowProjectionPlan<T> {
  if (args.destinations.length > 1) {
    return {
      outcome: "conflict",
      issues: [{ code: args.duplicateCode, field: args.field }],
    };
  }
  const existing = args.destinations[0];
  if (!existing) return { outcome: "create", value: args.expected };
  if (!workflowProjectionsEqual(existing, args.expected)) {
    return {
      outcome: "conflict",
      issues: [{ code: args.mismatchCode, field: args.field }],
    };
  }
  return { outcome: "unchanged" };
}

function customValueType(value: unknown): WorkflowCustomValueType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "string") return "string";
  if (typeof value === "number" && Number.isFinite(value)) return "number";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "object") return "object";
  throw new Error("Unsupported custom field value");
}

export function buildWorkflowCustomValue(
  sourceKey: string,
  value: unknown,
): WorkflowCustomValue {
  const valueJson = JSON.stringify(canonicalize(value));
  if (valueJson === undefined)
    throw new Error("Unsupported custom field value");
  return {
    sourceKey: normalizeWorkflowSourceKey(sourceKey),
    valueType: customValueType(value),
    valueJson,
  };
}
