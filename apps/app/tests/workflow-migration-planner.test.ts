import { describe, expect, it } from "vitest";
import {
  WORKFLOW_MIGRATION_KEY,
  WORKFLOW_MIGRATION_VERSION,
  buildWorkflowCustomValue,
  normalizeWorkflowSourceKey,
  planWorkflowProjection,
} from "../convex/workflowMigrationPlanner";

describe("workflow migration planner", () => {
  it("uses the registered migration identity", () => {
    expect(WORKFLOW_MIGRATION_KEY).toBe("full-schema-workflow-events");
    expect(WORKFLOW_MIGRATION_VERSION).toBe(1);
  });

  it("normalizes source keys and canonicalizes typed custom values", () => {
    expect(normalizeWorkflowSourceKey("  Hiring / Source  ")).toBe(
      "hiring-source",
    );
    expect(buildWorkflowCustomValue("Profile", { b: 2, a: 1 })).toEqual({
      sourceKey: "profile",
      valueType: "object",
      valueJson: '{"a":1,"b":2}',
    });
  });

  it("creates, preserves, and rejects unique destinations", () => {
    const expected = { sourceIndex: 0, action: "created" };
    expect(
      planWorkflowProjection({
        expected,
        destinations: [],
        duplicateCode: "DUPLICATE_EVALUATION_EVENT",
        mismatchCode: "EVALUATION_EVENT_MISMATCH",
        field: "sourceIndex",
      }),
    ).toEqual({ outcome: "create", value: expected });
    expect(
      planWorkflowProjection({
        expected,
        destinations: [{ action: "created", sourceIndex: 0 }],
        duplicateCode: "DUPLICATE_EVALUATION_EVENT",
        mismatchCode: "EVALUATION_EVENT_MISMATCH",
        field: "sourceIndex",
      }),
    ).toEqual({ outcome: "unchanged" });
    expect(
      planWorkflowProjection({
        expected,
        destinations: [expected, expected],
        duplicateCode: "DUPLICATE_EVALUATION_EVENT",
        mismatchCode: "EVALUATION_EVENT_MISMATCH",
        field: "sourceIndex",
      }),
    ).toEqual({
      outcome: "conflict",
      issues: [{ code: "DUPLICATE_EVALUATION_EVENT", field: "sourceIndex" }],
    });
    expect(
      planWorkflowProjection({
        expected,
        destinations: [{ ...expected, action: "locked" }],
        duplicateCode: "DUPLICATE_EVALUATION_EVENT",
        mismatchCode: "EVALUATION_EVENT_MISMATCH",
        field: "sourceIndex",
      }),
    ).toEqual({
      outcome: "conflict",
      issues: [{ code: "EVALUATION_EVENT_MISMATCH", field: "sourceIndex" }],
    });
  });

  it("rejects unsupported custom values", () => {
    expect(() => buildWorkflowCustomValue("missing", undefined)).toThrow(
      "Unsupported custom field value",
    );
  });
});
