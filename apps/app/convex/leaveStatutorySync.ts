import type { LeavePresetPolicy } from "../lib/leave/presets";
import {
  buildGovernmentPreset,
  buildPrivateSectorPreset,
} from "../lib/leave/presets";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

const MAX_POLICIES = 100;
const MAX_VERSIONS = 100;

export type StatutoryPolicySyncResult = {
  createdPolicyCount: number;
  coveredPolicyCount: number;
};

function presetVersionFields(preset: LeavePresetPolicy) {
  const rules = preset.rules;
  return {
    accountBehavior: rules.accountBehavior,
    ...(rules.poolKey !== undefined ? { poolKey: rules.poolKey } : {}),
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
    sourceCitation: preset.sourceUrl,
    sourceEffectiveDate: preset.sourceEffectiveDate,
  };
}

async function latestPolicyVersion(
  ctx: Pick<MutationCtx, "db">,
  policyId: Id<"leavePolicies">,
): Promise<Doc<"leavePolicyVersions"> | undefined> {
  const versions = await ctx.db
    .query("leavePolicyVersions")
    .withIndex("by_policy_effective", (query) =>
      query.eq("leavePolicyId", policyId),
    )
    .order("desc")
    .take(MAX_VERSIONS + 1);
  if (versions.length > MAX_VERSIONS) {
    throw new Error("Leave policy version history exceeds the supported limit");
  }
  return versions[0];
}

async function findPrivateSilCoveragePolicy(
  ctx: Pick<MutationCtx, "db">,
  policies: readonly Doc<"leavePolicies">[],
): Promise<Doc<"leavePolicies"> | undefined> {
  const candidates = policies.filter(
    (policy) =>
      policy.state === "active" &&
      policy.category === "company",
  );
  for (const policy of candidates) {
    const version = await latestPolicyVersion(ctx, policy._id);
    if (
      version &&
      version.accountBehavior === "shared_pool" &&
      version.payTreatment === "company_paid" &&
      version.durationBasis === "scheduled_work" &&
      (version.entitlementMethod === "annual" ||
        version.entitlementMethod === "monthly" ||
        version.entitlementMethod === "semi_annual") &&
      version.annualUnits !== undefined &&
      version.annualUnits >= 5 &&
      version.completedServiceMonths <= 12
    ) {
      return policy;
    }
  }
  return undefined;
}

export async function synchronizeOrganizationStatutoryPolicies(
  ctx: MutationCtx,
  args: {
    organizationId: Id<"organizations">;
    employmentSector: "private" | "government";
    effectiveStart: number;
    changeReason: string;
    userId: Id<"users">;
    now: number;
  },
): Promise<StatutoryPolicySyncResult> {
  const policies = await ctx.db
    .query("leavePolicies")
    .withIndex("by_organization", (query) =>
      query.eq("organizationId", args.organizationId),
    )
    .take(MAX_POLICIES + 1);
  if (policies.length > MAX_POLICIES) {
    throw new Error("Leave policy configuration exceeds the supported limit");
  }
  const preset =
    args.employmentSector === "private"
      ? buildPrivateSectorPreset()
      : buildGovernmentPreset();
  const silCoverage =
    args.employmentSector === "private"
      ? await findPrivateSilCoveragePolicy(ctx, policies)
      : undefined;
  let createdPolicyCount = 0;
  let coveredPolicyCount = 0;

  for (const statutory of preset.policies.filter(
    (candidate) => candidate.enabledByDefault,
  )) {
    const existing = policies.find(
      (policy) => policy.sourceKey === statutory.sourceKey,
    );
    const coveredByPolicyId =
      statutory.complianceRole === "private_sil_minimum"
        ? silCoverage?._id
        : undefined;
    if (existing) {
      if (
        coveredByPolicyId !== undefined &&
        existing.coveredByPolicyId !== coveredByPolicyId
      ) {
        await ctx.db.patch(existing._id, {
          coveredByPolicyId,
          updatedAt: args.now,
        });
        coveredPolicyCount += 1;
      }
      continue;
    }
    const policyId = await ctx.db.insert("leavePolicies", {
      organizationId: args.organizationId,
      sourceKey: statutory.sourceKey,
      name: statutory.name,
      category: statutory.category,
      confidentiality: statutory.confidentiality,
      state: "active",
      ...(statutory.complianceRole !== undefined
        ? { complianceRole: statutory.complianceRole }
        : {}),
      ...(coveredByPolicyId !== undefined ? { coveredByPolicyId } : {}),
      createdBy: args.userId,
      createdAt: args.now,
      updatedAt: args.now,
    });
    await ctx.db.insert("leavePolicyVersions", {
      organizationId: args.organizationId,
      leavePolicyId: policyId,
      version: 1,
      effectiveStart: args.effectiveStart,
      ...presetVersionFields(statutory),
      createdBy: args.userId,
      createdAt: args.now,
      changeReason: args.changeReason,
    });
    createdPolicyCount += 1;
    if (coveredByPolicyId !== undefined) coveredPolicyCount += 1;
  }
  return { createdPolicyCount, coveredPolicyCount };
}
