import { v } from "convex/values";
import { internalMutation, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import {
  normalizeDepartmentName,
  planOrganizationNormalization,
  valuesEqual,
} from "./databaseMigrationPlanner";
import type {
  SchemaCleanupCounters,
  SchemaCleanupIssue,
} from "./databaseMigrationTypes";

function addCounters(
  current: SchemaCleanupCounters,
  increment: Partial<SchemaCleanupCounters>,
): SchemaCleanupCounters {
  return {
    scanned: current.scanned + (increment.scanned ?? 0),
    changed: current.changed + (increment.changed ?? 0),
    unchanged: current.unchanged + (increment.unchanged ?? 0),
    skipped: current.skipped + (increment.skipped ?? 0),
    conflicts: current.conflicts + (increment.conflicts ?? 0),
    errors: current.errors + (increment.errors ?? 0),
  };
}

type DestinationResult = "changed" | "unchanged" | "conflict";

function comparableRow(
  row: object,
  ignoredFields: readonly string[],
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).filter(([key]) => !ignoredFields.includes(key)),
  );
}

function destinationResult(
  rows: object[],
  expected: object,
): DestinationResult {
  if (rows.length === 0) return "changed";
  if (rows.length > 1) return "conflict";
  return valuesEqual(
    comparableRow(rows[0], ["_id", "_creationTime", "createdAt", "updatedAt"]),
    expected,
  )
    ? "unchanged"
    : "conflict";
}

async function recordIssue(
  ctx: MutationCtx,
  args: {
    runId: Id<"migrationRuns">;
    organizationId: Id<"organizations">;
    entityType: string;
    entityId?: string;
    field: string;
    code: string;
    now: number;
  },
) {
  await ctx.db.insert("migrationIssues", {
    runId: args.runId,
    organizationId: args.organizationId,
    entityType: args.entityType,
    entityId: args.entityId,
    field: args.field,
    code: args.code,
    createdAt: args.now,
  });
}

export const processSchemaCleanupBatch = internalMutation({
  args: { runId: v.id("migrationRuns") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.key !== "schema-normalization-release-1") {
      throw new Error("Schema cleanup run was not found");
    }
    if (run.status !== "running") {
      throw new Error("Schema cleanup run is not active");
    }

    const page = await ctx.db.query("organizations").paginate({
      cursor: run.cursor ?? null,
      numItems: run.batchSize,
    });
    let counters = run.counters;
    const now = Date.now();

    for (const organization of page.page) {
      counters = addCounters(counters, { scanned: 1 });
      const settingsRows = await ctx.db
        .query("settings")
        .withIndex("by_organization", (q) =>
          q.eq("organizationId", organization._id),
        )
        .collect();

      const issues: SchemaCleanupIssue[] = [];
      if (settingsRows.length > 1) {
        issues.push({
          code: "DUPLICATE_SETTINGS_ROWS",
          field: "settings",
        });
      }
      const legacySettings =
        settingsRows.length === 1 ? settingsRows[0] : null;
      const plan = planOrganizationNormalization({
        organization,
        legacySettings,
      });
      issues.push(...plan.issues);

      for (const issue of issues) {
        await recordIssue(ctx, {
          runId: run._id,
          organizationId: organization._id,
          entityType: "organization",
          entityId: organization._id,
          field: issue.field,
          code: issue.code,
          now,
        });
      }
      counters = addCounters(counters, { conflicts: issues.length });

      if (run.dryRun) continue;

      const payrollExpected = {
        organizationId: organization._id,
        ...plan.payroll,
        ...(legacySettings?._id
          ? { sourceSettingsId: legacySettings._id }
          : {}),
        migrationVersion: run.version,
      };
      const payrollRows = await ctx.db
        .query("organizationPayrollSettings")
        .withIndex("by_organization", (q) =>
          q.eq("organizationId", organization._id),
        )
        .collect();
      const payrollResult = destinationResult(payrollRows, payrollExpected);
      if (payrollResult === "changed") {
        await ctx.db.insert("organizationPayrollSettings", {
          ...payrollExpected,
          createdAt: now,
          updatedAt: now,
        });
      } else if (payrollResult === "conflict") {
        await recordIssue(ctx, {
          runId: run._id,
          organizationId: organization._id,
          entityType: "organizationPayrollSettings",
          field: "organizationId",
          code:
            payrollRows.length > 1
              ? "DUPLICATE_DESTINATION_ROWS"
              : "DESTINATION_VALUE_CONFLICT",
          now,
        });
      }
      counters = addCounters(counters, {
        changed: payrollResult === "changed" ? 1 : 0,
        unchanged: payrollResult === "unchanged" ? 1 : 0,
        conflicts: payrollResult === "conflict" ? 1 : 0,
      });

      if (plan.attendance) {
        const attendanceExpected = {
          organizationId: organization._id,
          attendanceSettings: plan.attendance,
          ...(legacySettings?._id
            ? { sourceSettingsId: legacySettings._id }
            : {}),
          migrationVersion: run.version,
        };
        const attendanceRows = await ctx.db
          .query("organizationAttendanceSettings")
          .withIndex("by_organization", (q) =>
            q.eq("organizationId", organization._id),
          )
          .collect();
        const attendanceResult = destinationResult(
          attendanceRows,
          attendanceExpected,
        );
        if (attendanceResult === "changed") {
          await ctx.db.insert("organizationAttendanceSettings", {
            ...attendanceExpected,
            createdAt: now,
            updatedAt: now,
          });
        } else if (attendanceResult === "conflict") {
          await recordIssue(ctx, {
            runId: run._id,
            organizationId: organization._id,
            entityType: "organizationAttendanceSettings",
            field: "organizationId",
            code:
              attendanceRows.length > 1
                ? "DUPLICATE_DESTINATION_ROWS"
                : "DESTINATION_VALUE_CONFLICT",
            now,
          });
        }
        counters = addCounters(counters, {
          changed: attendanceResult === "changed" ? 1 : 0,
          unchanged: attendanceResult === "unchanged" ? 1 : 0,
          conflicts: attendanceResult === "conflict" ? 1 : 0,
        });
      }

      for (const department of plan.departments) {
        const departmentExpected = {
          organizationId: organization._id,
          name: department.name,
          normalizedName: department.normalizedName,
          color: department.color,
          ...(department.departmentHeadUserId
            ? { departmentHeadUserId: department.departmentHeadUserId }
            : {}),
          ...(department.costCenter ? { costCenter: department.costCenter } : {}),
          ...(department.location ? { location: department.location } : {}),
          ...(department.parentDepartmentName
            ? {
                parentDepartmentNormalizedName: normalizeDepartmentName(
                  department.parentDepartmentName,
                ),
              }
            : {}),
          ...(legacySettings?._id
            ? { sourceSettingsId: legacySettings._id }
            : {}),
          migrationVersion: run.version,
        };
        const departmentRows = await ctx.db
          .query("organizationDepartments")
          .withIndex("by_organization_normalized_name", (q) =>
            q
              .eq("organizationId", organization._id)
              .eq("normalizedName", department.normalizedName),
          )
          .collect();
        const departmentResult = destinationResult(
          departmentRows,
          departmentExpected,
        );
        if (departmentResult === "changed") {
          await ctx.db.insert("organizationDepartments", {
            ...departmentExpected,
            createdAt: now,
            updatedAt: now,
          });
        } else if (departmentResult === "conflict") {
          await recordIssue(ctx, {
            runId: run._id,
            organizationId: organization._id,
            entityType: "organizationDepartment",
            entityId: department.normalizedName,
            field: "normalizedName",
            code:
              departmentRows.length > 1
                ? "DUPLICATE_DESTINATION_ROWS"
                : "DESTINATION_VALUE_CONFLICT",
            now,
          });
        }
        counters = addCounters(counters, {
          changed: departmentResult === "changed" ? 1 : 0,
          unchanged: departmentResult === "unchanged" ? 1 : 0,
          conflicts: departmentResult === "conflict" ? 1 : 0,
        });
      }

      for (const requirement of plan.requirements) {
        const requirementExpected = {
          organizationId: organization._id,
          ...requirement,
          source: "organization" as const,
          migrationVersion: run.version,
        };
        const requirementRows = await ctx.db
          .query("organizationRequirementDefinitions")
          .withIndex("by_organization_normalized_type", (q) =>
            q
              .eq("organizationId", organization._id)
              .eq("normalizedType", requirement.normalizedType),
          )
          .collect();
        const requirementResult = destinationResult(
          requirementRows,
          requirementExpected,
        );
        if (requirementResult === "changed") {
          await ctx.db.insert("organizationRequirementDefinitions", {
            ...requirementExpected,
            createdAt: now,
            updatedAt: now,
          });
        } else if (requirementResult === "conflict") {
          await recordIssue(ctx, {
            runId: run._id,
            organizationId: organization._id,
            entityType: "organizationRequirementDefinition",
            entityId: requirement.normalizedType,
            field: "normalizedType",
            code:
              requirementRows.length > 1
                ? "DUPLICATE_DESTINATION_ROWS"
                : "DESTINATION_VALUE_CONFLICT",
            now,
          });
        }
        counters = addCounters(counters, {
          changed: requirementResult === "changed" ? 1 : 0,
          unchanged: requirementResult === "unchanged" ? 1 : 0,
          conflicts: requirementResult === "conflict" ? 1 : 0,
        });
      }
    }

    const done = page.isDone;
    await ctx.db.patch(run._id, {
      status: done ? "completed" : "running",
      cursor: done ? undefined : page.continueCursor,
      counters,
      updatedAt: now,
      completedAt: done ? now : undefined,
    });

    return {
      done,
      cursor: done ? null : page.continueCursor,
      counters,
    };
  },
});
