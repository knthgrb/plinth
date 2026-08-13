import type { CurrentSchemaTable } from "./fullSchemaInventory";
import { RELEASE_3_REMOVALS } from "./release3Contract";

export type Release3CleanupIssue = {
  code: "MALFORMED_NESTED_PARENT";
  field: string;
};

export type Release3CleanupPlan = {
  outcome: "change" | "unchanged" | "conflict";
  patch: Record<string, unknown>;
  changedFields: string[];
  issues: Release3CleanupIssue[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function planRelease3ContractCleanup(
  table: CurrentSchemaTable,
  document: Record<string, unknown>,
): Release3CleanupPlan {
  const removals = RELEASE_3_REMOVALS.filter((entry) => entry.table === table);
  const patch: Record<string, unknown> = {};
  const changedFields: string[] = [];
  const issues: Release3CleanupIssue[] = [];
  const nestedParents = new Map<string, Record<string, unknown>>();

  for (const removal of removals) {
    const [parent, child] = removal.field.split(".");
    if (!child) {
      if (Object.hasOwn(document, parent) && document[parent] !== undefined) {
        patch[parent] = undefined;
        changedFields.push(removal.field);
      }
      continue;
    }
    const parentValue = document[parent];
    if (parentValue === undefined) continue;
    if (!isRecord(parentValue)) {
      if (!issues.some((issue) => issue.field === parent)) {
        issues.push({ code: "MALFORMED_NESTED_PARENT", field: parent });
      }
      continue;
    }
    if (!Object.hasOwn(parentValue, child) || parentValue[child] === undefined) {
      continue;
    }
    const nextParent = nestedParents.get(parent) ?? { ...parentValue };
    delete nextParent[child];
    nestedParents.set(parent, nextParent);
    changedFields.push(removal.field);
  }

  for (const [parent, value] of nestedParents) patch[parent] = value;
  if (issues.length > 0) {
    return { outcome: "conflict", patch: {}, changedFields: [], issues };
  }
  return {
    outcome: changedFields.length > 0 ? "change" : "unchanged",
    patch,
    changedFields,
    issues: [],
  };
}
