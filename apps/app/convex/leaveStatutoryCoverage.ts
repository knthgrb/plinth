import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

const MAX_POLICY_VERSIONS = 100;
const MAX_ORGANIZATION_POLICIES = 100;

type CoverageContext = Pick<QueryCtx | MutationCtx, "db">;

export async function isStatutoryPolicyCoveredAt(
  ctx: CoverageContext,
  policy: Doc<"leavePolicies">,
  effectiveDate: number,
): Promise<boolean> {
  if (policy.category !== "statutory") return false;
  const statutoryVersion = await getEffectiveVersion(
    ctx,
    policy._id,
    effectiveDate,
  );
  if (!statutoryVersion) return false;

  if (policy.complianceRole === "private_sil_minimum") {
    const policies = await ctx.db
      .query("leavePolicies")
      .withIndex("by_organization", (query) =>
        query.eq("organizationId", policy.organizationId),
      )
      .take(MAX_ORGANIZATION_POLICIES + 1);
    if (policies.length > MAX_ORGANIZATION_POLICIES) {
      throw new Error("Leave policy configuration exceeds the supported limit");
    }
    for (const candidate of policies) {
      if (candidate.category !== "company") continue;
      const version = await getEffectiveVersion(ctx, candidate._id, effectiveDate);
      if (version && coversStatutoryVersion(version, statutoryVersion)) {
        return true;
      }
    }
    return false;
  }

  if (policy.coveredByPolicyId === undefined) return false;
  const [coveringPolicy, coveringVersion] = await Promise.all([
    ctx.db.get(policy.coveredByPolicyId),
    getEffectiveVersion(ctx, policy.coveredByPolicyId, effectiveDate),
  ]);
  if (
    !coveringPolicy ||
    coveringPolicy.organizationId !== policy.organizationId ||
    coveringPolicy.category !== "company" ||
    !coveringVersion
  ) {
    return false;
  }
  return coversStatutoryVersion(coveringVersion, statutoryVersion);
}

function coversStatutoryVersion(
  coveringVersion: Doc<"leavePolicyVersions">,
  statutoryVersion: Doc<"leavePolicyVersions">,
): boolean {
  const coveringMethod = coveringVersion.entitlementMethod;
  return (
    coveringVersion.accountBehavior === "shared_pool" &&
    coveringVersion.payTreatment === "company_paid" &&
    coveringVersion.durationBasis === "scheduled_work" &&
    (coveringMethod === "annual" ||
      coveringMethod === "monthly" ||
      coveringMethod === "semi_annual") &&
    coveringVersion.annualUnits !== undefined &&
    coveringVersion.annualUnits >= (statutoryVersion.annualUnits ?? 0) &&
    coveringVersion.completedServiceMonths <=
      statutoryVersion.completedServiceMonths
  );
}

async function getEffectiveVersion(
  ctx: CoverageContext,
  policyId: Id<"leavePolicies">,
  effectiveDate: number,
): Promise<Doc<"leavePolicyVersions"> | undefined> {
  const versions = await ctx.db
    .query("leavePolicyVersions")
    .withIndex("by_policy_effective", (query) =>
      query.eq("leavePolicyId", policyId).lte("effectiveStart", effectiveDate),
    )
    .order("desc")
    .take(MAX_POLICY_VERSIONS + 1);
  if (versions.length > MAX_POLICY_VERSIONS) {
    throw new Error("Leave policy version history exceeds the supported limit");
  }
  return versions.find(
    (version) =>
      version.effectiveEnd === undefined || version.effectiveEnd >= effectiveDate,
  );
}
