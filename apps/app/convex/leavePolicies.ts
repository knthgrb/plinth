import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireActiveMembership } from "./access";
import {
  buildGovernmentPreset,
  buildPrivateSectorPreset,
  type LeavePresetPolicy,
} from "../lib/leave/presets";
import type { LeavePolicyRules } from "../lib/leave/types";
import { assertLeavePolicyAdministrationAllowed } from "./leaveMigration";

const MAX_POLICY_ROWS = 100;
const MAX_IMPACT_ROWS = 1_000;

const requiredDocumentRuleValidator = v.object({
  documentType: v.string(),
  minimumDuration: v.optional(v.number()),
  requiredBefore: v.union(v.literal("submission"), v.literal("approval")),
});

const leavePolicyRulesValidator = v.object({
  accountBehavior: v.union(
    v.literal("shared_pool"),
    v.literal("individual_account"),
    v.literal("non_credit"),
  ),
  poolKey: v.optional(v.string()),
  payTreatment: v.union(
    v.literal("company_paid"),
    v.literal("statutory_paid"),
    v.literal("government_paid"),
    v.literal("statutory_benefit_supported"),
    v.literal("unpaid"),
  ),
  durationBasis: v.union(
    v.literal("scheduled_work"),
    v.literal("calendar_days"),
    v.literal("event_defined"),
  ),
  entitlementMethod: v.union(
    v.literal("annual"),
    v.literal("monthly"),
    v.literal("semi_annual"),
    v.literal("anniversary"),
    v.literal("event_based"),
    v.literal("none"),
  ),
  annualUnits: v.optional(v.number()),
  eligibility: v.object({
    basis: v.union(
      v.literal("hire_date"),
      v.literal("regularization_date"),
      v.literal("verified_qualification"),
      v.literal("event"),
    ),
    completedServiceMonths: v.number(),
  }),
  prorationMethod: v.union(
    v.literal("none"),
    v.literal("calendar_months"),
    v.literal("actual_days"),
    v.literal("legacy_15th_day"),
  ),
  roundingIncrement: v.union(v.literal(0.25), v.literal(0.5), v.literal(1)),
  carryover: v.object({
    mode: v.union(
      v.literal("none"),
      v.literal("capped"),
      v.literal("unlimited"),
    ),
    capUnits: v.optional(v.number()),
  }),
  conversion: v.object({
    allowed: v.boolean(),
    maxUnits: v.optional(v.number()),
  }),
  maximumConsecutiveUnits: v.optional(v.number()),
  minimumNoticeDays: v.optional(v.number()),
  requiredDocumentRules: v.optional(v.array(requiredDocumentRuleValidator)),
  qualifyingEventRequired: v.optional(v.boolean()),
  maximumUnitsPerEvent: v.optional(v.number()),
  maximumUnitsPerYear: v.optional(v.number()),
  eventUseWindowDays: v.optional(v.number()),
});

type RequiredDocumentRule = {
  documentType: string;
  minimumDuration?: number;
  requiredBefore: "submission" | "approval";
};

export type LeavePolicyVersionRules = LeavePolicyRules & {
  maximumConsecutiveUnits?: number;
  minimumNoticeDays?: number;
  requiredDocumentRules?: RequiredDocumentRule[];
};

export type LeaveConfiguration = {
  settings: Doc<"organizationLeaveSettings"> | null;
  policies: Array<{
    policy: Doc<"leavePolicies">;
    versions: Doc<"leavePolicyVersions">[];
  }>;
};

export type LeavePolicyImpact = {
  currentVersion: number;
  nextVersion: number;
  affectedBalanceCount: number;
  affectedRequestCount: number;
  warnings: string[];
};

type PolicyContext = Pick<QueryCtx | MutationCtx, "auth" | "db">;

function assertEffectiveDate(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} is required`);
  }
}

function assertManilaMonthBoundary(value: number): void {
  const manila = new Date(value + 8 * 60 * 60 * 1_000);
  if (
    manila.getUTCDate() !== 1 ||
    manila.getUTCHours() !== 0 ||
    manila.getUTCMinutes() !== 0 ||
    manila.getUTCSeconds() !== 0 ||
    manila.getUTCMilliseconds() !== 0
  ) {
    throw new Error(
      "Monthly leave policy versions must start on the first day of a Manila month",
    );
  }
}

function requireReason(value: string, label: string): string {
  const reason = value.trim();
  if (!reason) throw new Error(`${label} is required`);
  return reason;
}

function assertNonNegative(value: number | undefined, label: string): void {
  if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
    throw new Error(`${label} must be a non-negative number`);
  }
}

function validateRules(rules: LeavePolicyVersionRules): void {
  assertNonNegative(rules.annualUnits, "Annual entitlement");
  assertNonNegative(
    rules.eligibility.completedServiceMonths,
    "Completed service months",
  );
  assertNonNegative(rules.carryover.capUnits, "Carryover cap");
  assertNonNegative(rules.conversion.maxUnits, "Conversion cap");
  assertNonNegative(
    rules.maximumConsecutiveUnits,
    "Maximum consecutive duration",
  );
  assertNonNegative(rules.minimumNoticeDays, "Minimum notice");
  assertNonNegative(rules.maximumUnitsPerEvent, "Maximum units per event");
  assertNonNegative(rules.maximumUnitsPerYear, "Maximum units per year");
  assertNonNegative(rules.eventUseWindowDays, "Event use window");
  if (rules.accountBehavior === "shared_pool" && !rules.poolKey?.trim()) {
    throw new Error("Shared-pool policies require a pool key");
  }
  if (rules.accountBehavior !== "shared_pool" && rules.poolKey !== undefined) {
    throw new Error("Only shared-pool policies can define a pool key");
  }
  if (rules.carryover.mode === "capped" && rules.carryover.capUnits === undefined) {
    throw new Error("Capped carryover requires a carryover cap");
  }
  if (!rules.conversion.allowed && rules.conversion.maxUnits !== undefined) {
    throw new Error("Conversion cap requires conversion to be enabled");
  }
}

async function requirePolicyAdministrator(
  ctx: PolicyContext,
  organizationId: Id<"organizations">,
) {
  const access = await requireActiveMembership(ctx, organizationId);
  if (
    access.membership.role !== "owner" &&
    access.membership.role !== "admin" &&
    access.membership.role !== "hr"
  ) {
    throw new Error("Owner, Admin, or HR access is required");
  }
  return access;
}

async function requirePolicyOwner(
  ctx: PolicyContext,
  organizationId: Id<"organizations">,
) {
  const access = await requireActiveMembership(ctx, organizationId);
  if (access.membership.role !== "owner") {
    throw new Error("Owner access is required");
  }
  return access;
}

async function getLeaveSettings(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  organizationId: Id<"organizations">,
): Promise<Doc<"organizationLeaveSettings"> | null> {
  const rows = await ctx.db
    .query("organizationLeaveSettings")
    .withIndex("by_organization", (builder) =>
      builder.eq("organizationId", organizationId),
    )
    .take(2);
  if (rows.length > 1) throw new Error("Duplicate organization leave settings");
  return rows[0] ?? null;
}

async function getOrganizationPolicies(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  organizationId: Id<"organizations">,
): Promise<Doc<"leavePolicies">[]> {
  const policies = await ctx.db
    .query("leavePolicies")
    .withIndex("by_organization", (builder) =>
      builder.eq("organizationId", organizationId),
    )
    .take(MAX_POLICY_ROWS + 1);
  if (policies.length > MAX_POLICY_ROWS) {
    throw new Error("Leave policy configuration exceeds the supported limit");
  }
  return policies;
}

async function getPolicyVersions(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  leavePolicyId: Id<"leavePolicies">,
): Promise<Doc<"leavePolicyVersions">[]> {
  const versions = await ctx.db
    .query("leavePolicyVersions")
    .withIndex("by_policy_effective", (builder) =>
      builder.eq("leavePolicyId", leavePolicyId),
    )
    .take(MAX_POLICY_ROWS + 1);
  if (versions.length > MAX_POLICY_ROWS) {
    throw new Error("Leave policy version history exceeds the supported limit");
  }
  return versions;
}

function presetForSourceKey(sourceKey: string): LeavePresetPolicy | undefined {
  return [
    ...buildPrivateSectorPreset().policies,
    ...buildGovernmentPreset().policies,
  ].find((policy) => policy.sourceKey === sourceKey);
}

function assertAtLeast(
  actual: number | undefined,
  baseline: number | undefined,
  label: string,
): void {
  if (baseline !== undefined && (actual === undefined || actual < baseline)) {
    throw new Error(`Policy cannot reduce the statutory ${label}`);
  }
}

function assertStatutoryBaseline(
  policy: Doc<"leavePolicies">,
  rules: LeavePolicyVersionRules,
): void {
  const preset = presetForSourceKey(policy.sourceKey);
  if (policy.category !== "statutory" || !preset) return;
  const baseline = preset.rules;
  const fixedFields: Array<
    [string, string | number | boolean | undefined, string | number | boolean | undefined]
  > = [
    ["account behavior", rules.accountBehavior, baseline.accountBehavior],
    ["pool", rules.poolKey, baseline.poolKey],
    ["pay treatment", rules.payTreatment, baseline.payTreatment],
    ["duration basis", rules.durationBasis, baseline.durationBasis],
    ["entitlement method", rules.entitlementMethod, baseline.entitlementMethod],
    ["eligibility basis", rules.eligibility.basis, baseline.eligibility.basis],
    ["proration method", rules.prorationMethod, baseline.prorationMethod],
    ["rounding increment", rules.roundingIncrement, baseline.roundingIncrement],
  ];
  const changed = fixedFields.find(([, actual, expected]) => actual !== expected);
  if (changed) {
    throw new Error(`Policy cannot weaken the statutory ${changed[0]}`);
  }
  assertAtLeast(rules.annualUnits, baseline.annualUnits, "annual entitlement");
  assertAtLeast(
    rules.maximumUnitsPerEvent,
    baseline.maximumUnitsPerEvent,
    "per-event entitlement",
  );
  assertAtLeast(
    rules.maximumUnitsPerYear,
    baseline.maximumUnitsPerYear,
    "annual event entitlement",
  );
  if (
    rules.eligibility.completedServiceMonths >
    baseline.eligibility.completedServiceMonths
  ) {
    throw new Error("Policy cannot delay statutory eligibility");
  }
  if (baseline.qualifyingEventRequired && !rules.qualifyingEventRequired) {
    throw new Error("Policy cannot remove the statutory qualifying event");
  }
  if (baseline.conversion.allowed && !rules.conversion.allowed) {
    throw new Error("Policy cannot remove statutory conversion");
  }
  if (
    baseline.carryover.mode === "unlimited" &&
    rules.carryover.mode !== "unlimited"
  ) {
    throw new Error("Policy cannot reduce statutory carryover");
  }
  if (
    baseline.carryover.mode === "capped" &&
    (rules.carryover.mode === "none" ||
      (rules.carryover.mode === "capped" &&
        (rules.carryover.capUnits ?? 0) < (baseline.carryover.capUnits ?? 0)))
  ) {
    throw new Error("Policy cannot reduce statutory carryover");
  }
}

function versionFields(
  rules: LeavePolicyVersionRules,
  preset: LeavePresetPolicy | undefined,
) {
  return {
    accountBehavior: rules.accountBehavior,
    ...(rules.poolKey !== undefined ? { poolKey: rules.poolKey.trim() } : {}),
    payTreatment: rules.payTreatment,
    durationBasis: rules.durationBasis,
    entitlementMethod: rules.entitlementMethod,
    ...(rules.annualUnits !== undefined ? { annualUnits: rules.annualUnits } : {}),
    ...(rules.entitlementMethod === "monthly" && rules.annualUnits !== undefined
      ? { accrualRate: rules.annualUnits / 12 }
      : {}),
    eligibilityBasis: rules.eligibility.basis,
    completedServiceMonths: rules.eligibility.completedServiceMonths,
    prorationMethod: rules.prorationMethod,
    roundingIncrement: rules.roundingIncrement,
    carryoverMode: rules.carryover.mode,
    ...(rules.carryover.capUnits !== undefined
      ? { carryoverCap: rules.carryover.capUnits }
      : {}),
    conversionAllowed: rules.conversion.allowed,
    ...(rules.conversion.maxUnits !== undefined
      ? { maxConvertibleUnits: rules.conversion.maxUnits }
      : {}),
    ...(rules.maximumConsecutiveUnits !== undefined
      ? { maximumConsecutiveUnits: rules.maximumConsecutiveUnits }
      : {}),
    ...(rules.minimumNoticeDays !== undefined
      ? { minimumNoticeDays: rules.minimumNoticeDays }
      : {}),
    ...(rules.requiredDocumentRules !== undefined
      ? { requiredDocumentRules: rules.requiredDocumentRules }
      : {}),
    ...(rules.qualifyingEventRequired !== undefined
      ? { qualifyingEventRequired: rules.qualifyingEventRequired }
      : {}),
    ...(rules.maximumUnitsPerEvent !== undefined
      ? { maximumUnitsPerEvent: rules.maximumUnitsPerEvent }
      : {}),
    ...(rules.maximumUnitsPerYear !== undefined
      ? { maximumUnitsPerYear: rules.maximumUnitsPerYear }
      : {}),
    ...(rules.eventUseWindowDays !== undefined
      ? { eventUseWindowDays: rules.eventUseWindowDays }
      : {}),
    ...(preset
      ? {
          sourceCitation: preset.sourceUrl,
          sourceEffectiveDate: preset.sourceEffectiveDate,
        }
      : {}),
  };
}

async function createPresetPolicy(
  ctx: MutationCtx,
  organizationId: Id<"organizations">,
  preset: LeavePresetPolicy,
  effectiveStart: number,
  changeReason: string,
  userId: Id<"users">,
  now: number,
): Promise<boolean> {
  const existing = await ctx.db
    .query("leavePolicies")
    .withIndex("by_organization_source_key", (builder) =>
      builder.eq("organizationId", organizationId).eq("sourceKey", preset.sourceKey),
    )
    .unique();
  if (existing) return false;
  const policyId = await ctx.db.insert("leavePolicies", {
    organizationId,
    sourceKey: preset.sourceKey,
    name: preset.name,
    category: preset.category,
    confidentiality: preset.confidentiality,
    state: "active",
    ...(preset.complianceRole !== undefined
      ? { complianceRole: preset.complianceRole }
      : {}),
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.insert("leavePolicyVersions", {
    organizationId,
    leavePolicyId: policyId,
    version: 1,
    effectiveStart,
    ...versionFields(preset.rules, preset),
    createdBy: userId,
    createdAt: now,
    changeReason,
  });
  return true;
}

export const getLeaveConfiguration = query({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, args): Promise<LeaveConfiguration> => {
    await requirePolicyAdministrator(ctx, args.organizationId);
    const [settings, policies] = await Promise.all([
      getLeaveSettings(ctx, args.organizationId),
      getOrganizationPolicies(ctx, args.organizationId),
    ]);
    const configuredPolicies = await Promise.all(
      policies.map(async (policy) => ({
        policy,
        versions: await getPolicyVersions(ctx, policy._id),
      })),
    );
    return { settings, policies: configuredPolicies };
  },
});

export const configureLeaveSector = mutation({
  args: {
    organizationId: v.id("organizations"),
    employmentSector: v.union(v.literal("private"), v.literal("government")),
    effectiveStart: v.number(),
    changeReason: v.string(),
  },
  handler: async (ctx, args) => {
    await assertLeavePolicyAdministrationAllowed(ctx, args.organizationId);
    const access = await requirePolicyOwner(ctx, args.organizationId);
    assertEffectiveDate(args.effectiveStart, "Policy effective date");
    const changeReason = requireReason(args.changeReason, "Change reason");
    const existingSettings = await getLeaveSettings(ctx, args.organizationId);
    if (
      existingSettings?.employmentSector !== undefined &&
      existingSettings.employmentSector !== args.employmentSector
    ) {
      throw new Error("Organization leave sector is already configured");
    }
    const now = Date.now();
    if (existingSettings) {
      await ctx.db.patch(existingSettings._id, {
        employmentSector: args.employmentSector,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("organizationLeaveSettings", {
        organizationId: args.organizationId,
        employmentSector: args.employmentSector,
        policyYearBasis: "calendar_year",
        requestPrecision: "day",
        approvalSignatureMode: "none",
        migrationState: "active",
        activePolicyEngineVersion: 2,
        policyEngineCutoverAt: now,
        leaveTrackerMode:
          args.employmentSector === "private" ? "general" : "by_type",
        leaveAccrualFrequency:
          args.employmentSector === "private" ? "annual" : "monthly",
        ...(args.employmentSector === "private" ? { annualSil: 5 } : {}),
        migrationVersion: 2,
        createdAt: now,
        updatedAt: now,
      });
    }
    const preset =
      args.employmentSector === "private"
        ? buildPrivateSectorPreset()
        : buildGovernmentPreset();
    let createdPolicyCount = 0;
    for (const policy of preset.policies.filter(
      (candidate) => candidate.enabledByDefault,
    )) {
      if (
        await createPresetPolicy(
          ctx,
          args.organizationId,
          policy,
          args.effectiveStart,
          changeReason,
          access.user._id,
          now,
        )
      ) {
        createdPolicyCount += 1;
      }
    }
    return { createdPolicyCount };
  },
});

export const createCompanyLeavePolicy = mutation({
  args: {
    organizationId: v.id("organizations"),
    name: v.string(),
    sourceKey: v.string(),
    effectiveStart: v.number(),
    changeReason: v.string(),
    rules: leavePolicyRulesValidator,
  },
  handler: async (ctx, args) => {
    await assertLeavePolicyAdministrationAllowed(ctx, args.organizationId);
    const access = await requirePolicyAdministrator(ctx, args.organizationId);
    assertEffectiveDate(args.effectiveStart, "Policy effective date");
    const name = requireReason(args.name, "Policy name");
    const changeReason = requireReason(args.changeReason, "Change reason");
    validateRules(args.rules);
    if (args.rules.entitlementMethod === "monthly") {
      assertManilaMonthBoundary(args.effectiveStart);
    }
    const rawSourceKey = args.sourceKey
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    if (!rawSourceKey) throw new Error("Policy source key is required");
    const sourceKey = rawSourceKey.startsWith("company_")
      ? rawSourceKey
      : `company_${rawSourceKey}`;
    const existing = await ctx.db
      .query("leavePolicies")
      .withIndex("by_organization_source_key", (builder) =>
        builder
          .eq("organizationId", args.organizationId)
          .eq("sourceKey", sourceKey),
      )
      .unique();
    if (existing) throw new Error("Leave policy source key already exists");
    const now = Date.now();
    const leavePolicyId = await ctx.db.insert("leavePolicies", {
      organizationId: args.organizationId,
      sourceKey,
      name,
      category: args.rules.payTreatment === "unpaid" ? "unpaid" : "company",
      confidentiality: "standard",
      state: "active",
      createdBy: access.user._id,
      createdAt: now,
      updatedAt: now,
    });
    const policyVersionId = await ctx.db.insert("leavePolicyVersions", {
      organizationId: args.organizationId,
      leavePolicyId,
      version: 1,
      effectiveStart: args.effectiveStart,
      ...versionFields(args.rules, undefined),
      createdBy: access.user._id,
      createdAt: now,
      changeReason,
    });
    return { leavePolicyId, policyVersionId, version: 1 };
  },
});

export const createLeavePolicyVersion = mutation({
  args: {
    organizationId: v.id("organizations"),
    leavePolicyId: v.id("leavePolicies"),
    effectiveStart: v.number(),
    changeReason: v.string(),
    rules: leavePolicyRulesValidator,
  },
  handler: async (ctx, args) => {
    await assertLeavePolicyAdministrationAllowed(ctx, args.organizationId);
    const access = await requirePolicyAdministrator(ctx, args.organizationId);
    assertEffectiveDate(args.effectiveStart, "Policy effective date");
    const changeReason = requireReason(args.changeReason, "Change reason");
    validateRules(args.rules);
    const policy = await ctx.db.get(args.leavePolicyId);
    if (!policy || policy.organizationId !== args.organizationId) {
      throw new Error("Leave policy not found");
    }
    if (policy.state !== "active") throw new Error("Leave policy is archived");
    assertStatutoryBaseline(policy, args.rules);
    const versions = await getPolicyVersions(ctx, args.leavePolicyId);
    const current = versions.at(-1);
    if (!current) throw new Error("Leave policy has no current version");
    if (args.effectiveStart <= current.effectiveStart) {
      throw new Error("Effective date must be later than the current version");
    }
    if (current.effectiveEnd !== undefined) {
      throw new Error("Leave policy has no active version");
    }
    if (
      current.entitlementMethod === "monthly" ||
      args.rules.entitlementMethod === "monthly"
    ) {
      assertManilaMonthBoundary(args.effectiveStart);
    }
    await ctx.db.patch(current._id, {
      effectiveEnd: args.effectiveStart - 1,
    });
    const policyVersionId = await ctx.db.insert("leavePolicyVersions", {
      organizationId: args.organizationId,
      leavePolicyId: policy._id,
      version: current.version + 1,
      effectiveStart: args.effectiveStart,
      ...versionFields(args.rules, presetForSourceKey(policy.sourceKey)),
      createdBy: access.user._id,
      createdAt: Date.now(),
      changeReason,
    });
    return {
      leavePolicyId: policy._id,
      policyVersionId,
      version: current.version + 1,
    };
  },
});

export const archiveLeavePolicy = mutation({
  args: {
    organizationId: v.id("organizations"),
    leavePolicyId: v.id("leavePolicies"),
    effectiveEnd: v.number(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    await assertLeavePolicyAdministrationAllowed(ctx, args.organizationId);
    const access = await requirePolicyAdministrator(ctx, args.organizationId);
    assertEffectiveDate(args.effectiveEnd, "Archive effective date");
    requireReason(args.reason, "Archive reason");
    const policy = await ctx.db.get(args.leavePolicyId);
    if (!policy || policy.organizationId !== args.organizationId) {
      throw new Error("Leave policy not found");
    }
    if (policy.state === "archived") return { archived: true as const };
    if (policy.category === "statutory") {
      throw new Error("Statutory baseline policies cannot be archived");
    }
    const versions = await getPolicyVersions(ctx, policy._id);
    const current = versions.at(-1);
    if (!current) throw new Error("Leave policy has no current version");
    if (args.effectiveEnd < current.effectiveStart) {
      throw new Error("Archive date cannot precede the active version");
    }
    const now = Date.now();
    await ctx.db.patch(current._id, { effectiveEnd: args.effectiveEnd });
    if (args.effectiveEnd <= now) {
      await ctx.db.patch(policy._id, {
        state: "archived",
        archivedBy: access.user._id,
        archivedAt: args.effectiveEnd,
        updatedAt: now,
      });
    }
    return { archived: true as const };
  },
});

export const previewLeavePolicyImpact = query({
  args: {
    organizationId: v.id("organizations"),
    leavePolicyId: v.id("leavePolicies"),
    effectiveStart: v.number(),
    rules: leavePolicyRulesValidator,
  },
  handler: async (ctx, args): Promise<LeavePolicyImpact> => {
    await requirePolicyAdministrator(ctx, args.organizationId);
    assertEffectiveDate(args.effectiveStart, "Policy effective date");
    validateRules(args.rules);
    const policy = await ctx.db.get(args.leavePolicyId);
    if (!policy || policy.organizationId !== args.organizationId) {
      throw new Error("Leave policy not found");
    }
    assertStatutoryBaseline(policy, args.rules);
    const versions = await getPolicyVersions(ctx, policy._id);
    const current = versions.at(-1);
    if (!current) throw new Error("Leave policy has no current version");
    if (args.effectiveStart <= current.effectiveStart) {
      throw new Error("Effective date must be later than the current version");
    }
    const [requests, balances] = await Promise.all([
      ctx.db
        .query("leaveRequests")
        .withIndex("by_organization", (builder) =>
          builder.eq("organizationId", args.organizationId),
        )
        .take(MAX_IMPACT_ROWS + 1),
      ctx.db
        .query("employeeLeaveBalances")
        .withIndex("by_organization", (builder) =>
          builder.eq("organizationId", args.organizationId),
        )
        .take(MAX_IMPACT_ROWS + 1),
    ]);
    if (requests.length > MAX_IMPACT_ROWS || balances.length > MAX_IMPACT_ROWS) {
      throw new Error("Leave policy impact preview exceeds the supported limit");
    }
    const affectedRequestCount = requests.filter(
      (request) =>
        request.policyId === policy._id &&
        (request.requestedStart ?? request.startDate) >= args.effectiveStart,
    ).length;
    const affectedBalanceCount = balances.filter(
      (balance) =>
        balance.policyId === policy._id &&
        (balance.periodEnd === undefined || balance.periodEnd >= args.effectiveStart),
    ).length;
    const warnings: string[] = [];
    if (affectedRequestCount > 0) {
      warnings.push("Future requests already reference the current policy version");
    }
    if (affectedBalanceCount > 0) {
      warnings.push("Open balance periods reference the current policy version");
    }
    return {
      currentVersion: current.version,
      nextVersion: current.version + 1,
      affectedBalanceCount,
      affectedRequestCount,
      warnings,
    };
  },
});
