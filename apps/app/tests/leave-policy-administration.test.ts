import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import type { Doc, Id } from "../convex/_generated/dataModel";
import type {
  LeaveConfiguration,
  LeavePolicyImpact,
} from "../convex/leavePolicies";
import schema from "../convex/schema";
import { buildGovernmentPreset } from "../lib/leave/presets";
import type { LeavePolicyRules } from "../lib/leave/types";

const rawModules = import.meta.glob("../convex/**/*.ts");
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => [
    path.replace("../convex/", "./"),
    loader,
  ]),
);

const MANILA_OFFSET = 8 * 60 * 60 * 1_000;

function manilaDate(year: number, month: number, day: number): number {
  return Date.UTC(year, month - 1, day) - MANILA_OFFSET;
}

type PolicyVersionResult = {
  leavePolicyId: Id<"leavePolicies">;
  policyVersionId: Id<"leavePolicyVersions">;
  version: number;
};

const getLeaveConfiguration = makeFunctionReference<
  "query",
  { organizationId: Id<"organizations"> },
  LeaveConfiguration
>("leavePolicies:getLeaveConfiguration");
const configureLeaveSector = makeFunctionReference<
  "mutation",
  {
    organizationId: Id<"organizations">;
    employmentSector: "private" | "government";
    effectiveStart: number;
    changeReason: string;
  },
  { createdPolicyCount: number }
>("leavePolicies:configureLeaveSector");
const scheduleCompanyLeaveModelChange = makeFunctionReference<
  "mutation",
  {
    organizationId: Id<"organizations">;
    mode: "pooled" | "by_type";
    effectiveStart: number;
    changeReason: string;
  },
  { mode: "pooled" | "by_type"; effectiveStart: number; version: number }
>("leavePolicies:scheduleCompanyLeaveModelChange");
const getCompanyLeaveModel = makeFunctionReference<
  "query",
  { organizationId: Id<"organizations">; asOf?: number },
  {
    effectiveMode: "pooled" | "by_type";
    effectiveStart: number;
    requiresNormalization: boolean;
    scheduled?: {
      mode: "pooled" | "by_type";
      effectiveStart: number;
      version: number;
    };
  }
>("leavePolicies:getCompanyLeaveModel");
const synchronizeStatutoryPolicies = makeFunctionReference<
  "mutation",
  { organizationId: Id<"organizations"> },
  { createdPolicyCount: number; coveredPolicyCount: number }
>("leavePolicies:synchronizeStatutoryPolicies");
const configureAnniversaryLeave = makeFunctionReference<
  "mutation",
  {
    organizationId: Id<"organizations">;
    enabled: boolean;
    maximumDays: number;
    serviceDateBasis: "hire_date" | "regularization_date";
    effectiveStart: number;
    changeReason: string;
  },
  {
    enabled: boolean;
    policyId?: Id<"leavePolicies">;
    policyVersionId?: Id<"leavePolicyVersions">;
  }
>("leavePolicies:configureAnniversaryLeave");
const createLeavePolicyVersion = makeFunctionReference<
  "mutation",
  {
    organizationId: Id<"organizations">;
    leavePolicyId: Id<"leavePolicies">;
    effectiveStart: number;
    changeReason: string;
    rules: LeavePolicyRules;
  },
  PolicyVersionResult
>("leavePolicies:createLeavePolicyVersion");
const createCompanyLeavePolicy = makeFunctionReference<
  "mutation",
  {
    organizationId: Id<"organizations">;
    name: string;
    sourceKey: string;
    effectiveStart: number;
    changeReason: string;
    rules: LeavePolicyRules;
  },
  PolicyVersionResult
>("leavePolicies:createCompanyLeavePolicy");
const archiveLeavePolicy = makeFunctionReference<
  "mutation",
  {
    organizationId: Id<"organizations">;
    leavePolicyId: Id<"leavePolicies">;
    effectiveEnd: number;
    reason: string;
  },
  { archived: true }
>("leavePolicies:archiveLeavePolicy");
const previewLeavePolicyImpact = makeFunctionReference<
  "query",
  {
    organizationId: Id<"organizations">;
    leavePolicyId: Id<"leavePolicies">;
    effectiveStart: number;
    rules: LeavePolicyRules;
  },
  LeavePolicyImpact
>("leavePolicies:previewLeavePolicyImpact");
const updateLeaveTypes = makeFunctionReference<
  "mutation",
  {
    organizationId: Id<"organizations">;
    annualSil: number;
    leaveTrackerMode: "general";
    leaveTypes: Array<{
      type: string;
      name: string;
      defaultCredits: number;
      isPaid: boolean;
      requiresApproval: boolean;
    }>;
  },
  { success: boolean }
>("settings:updateLeaveTypes");

type MembershipRole = Doc<"userOrganizations">["role"];

async function setupOrganization(role: MembershipRole = "owner") {
  const t = convexTest(schema, modules);
  const email = `leave-policy-${role}@example.com`;
  const organizationId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("organizations", {
      name: `Leave Policy ${role}`,
      createdAt: 1,
      updatedAt: 1,
    });
    const userId = await ctx.db.insert("users", {
      email,
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("userOrganizations", {
      userId,
      organizationId: id,
      role,
      accessStatus: "active",
      joinedAt: 1,
      updatedAt: 1,
    });
    return id;
  });
  return { t, actor: t.withIdentity({ email }), organizationId };
}

const moreGenerousPrivateSil: LeavePolicyRules = {
  accountBehavior: "shared_pool",
  poolKey: "company_leave",
  payTreatment: "company_paid",
  durationBasis: "scheduled_work",
  entitlementMethod: "annual",
  annualUnits: 8,
  eligibility: { basis: "hire_date", completedServiceMonths: 12 },
  prorationMethod: "none",
  roundingIncrement: 0.25,
  carryover: { mode: "unlimited" },
  conversion: { allowed: true },
};

describe("leave policy administration", () => {
  it("defaults private organizations to pooled company leave and government organizations to by-type", async () => {
    const privateOrganization = await setupOrganization();
    await privateOrganization.actor.mutation(configureLeaveSector, {
      organizationId: privateOrganization.organizationId,
      employmentSector: "private",
      effectiveStart: 100,
      changeReason: "Initial private setup",
    });
    const privateConfiguration = await privateOrganization.actor.query(
      getLeaveConfiguration,
      { organizationId: privateOrganization.organizationId },
    );

    const governmentOrganization = await setupOrganization();
    await governmentOrganization.actor.mutation(configureLeaveSector, {
      organizationId: governmentOrganization.organizationId,
      employmentSector: "government",
      effectiveStart: 100,
      changeReason: "Initial government setup",
    });
    const governmentConfiguration = await governmentOrganization.actor.query(
      getLeaveConfiguration,
      { organizationId: governmentOrganization.organizationId },
    );

    expect(privateConfiguration.settings).toMatchObject({
      companyLeaveDefaultMode: "pooled",
    });
    expect(governmentConfiguration.settings).toMatchObject({
      companyLeaveDefaultMode: "by_type",
    });
  });

  it("schedules one authoritative company model without rewriting historical policy versions", async () => {
    const owner = await setupOrganization();
    await owner.actor.mutation(configureLeaveSector, {
      organizationId: owner.organizationId,
      employmentSector: "private",
      effectiveStart: manilaDate(2039, 1, 1),
      changeReason: "Initial setup",
    });
    const pooledRules: LeavePolicyRules = {
      accountBehavior: "shared_pool",
      poolKey: "company_leave",
      payTreatment: "company_paid",
      durationBasis: "scheduled_work",
      entitlementMethod: "annual",
      annualUnits: 15,
      eligibility: { basis: "hire_date", completedServiceMonths: 0 },
      prorationMethod: "none",
      roundingIncrement: 1,
      carryover: { mode: "none" },
      conversion: { allowed: false },
    };
    const created = await owner.actor.mutation(createCompanyLeavePolicy, {
      organizationId: owner.organizationId,
      name: "General Leave",
      sourceKey: "company_general_leave",
      effectiveStart: manilaDate(2039, 1, 1),
      changeReason: "Create shared annual pool",
      rules: pooledRules,
    });

    await expect(
      owner.actor.mutation(scheduleCompanyLeaveModelChange, {
        organizationId: owner.organizationId,
        mode: "by_type",
        effectiveStart: manilaDate(2040, 1, 1),
        changeReason: "Use separate balances next policy year",
      }),
    ).resolves.toEqual({
      mode: "by_type",
      effectiveStart: manilaDate(2040, 1, 1),
      version: 2,
    });
    const beforeTransition = await owner.actor.query(getCompanyLeaveModel, {
      organizationId: owner.organizationId,
      asOf: manilaDate(2039, 12, 31),
    });
    const afterTransition = await owner.actor.query(getCompanyLeaveModel, {
      organizationId: owner.organizationId,
      asOf: manilaDate(2040, 1, 1),
    });
    const versions = await owner.t.run((ctx) =>
      ctx.db
        .query("leavePolicyVersions")
        .withIndex("by_policy_effective", (query) =>
          query.eq("leavePolicyId", created.leavePolicyId),
        )
        .collect(),
    );

    expect(beforeTransition).toMatchObject({
      effectiveMode: "pooled",
      scheduled: { mode: "by_type", effectiveStart: manilaDate(2040, 1, 1) },
    });
    expect(afterTransition).toMatchObject({
      effectiveMode: "by_type",
      effectiveStart: manilaDate(2040, 1, 1),
    });
    expect(versions).toHaveLength(2);
    expect(versions[0]).toMatchObject({
      accountBehavior: "shared_pool",
      effectiveEnd: manilaDate(2040, 1, 1) - 1,
    });
    expect(versions[1]).toMatchObject({
      accountBehavior: "individual_account",
      effectiveStart: manilaDate(2040, 1, 1),
    });

    const manager = await setupOrganization("manager");
    await expect(
      manager.actor.mutation(scheduleCompanyLeaveModelChange, {
        organizationId: manager.organizationId,
        mode: "pooled",
        effectiveStart: manilaDate(2040, 1, 1),
        changeReason: "Unauthorized transition",
      }),
    ).rejects.toThrow("Owner, Admin, or HR access is required");
  });

  it("rejects company policy account behavior that conflicts with the effective model", async () => {
    const { actor, organizationId } = await setupOrganization();
    await actor.mutation(configureLeaveSector, {
      organizationId,
      employmentSector: "private",
      effectiveStart: manilaDate(2039, 1, 1),
      changeReason: "Initial pooled setup",
    });

    await expect(
      actor.mutation(createCompanyLeavePolicy, {
        organizationId,
        name: "Vacation Leave",
        sourceKey: "company_vacation",
        effectiveStart: manilaDate(2039, 1, 1),
        changeReason: "Conflicting separate balance",
        rules: {
          accountBehavior: "individual_account",
          payTreatment: "company_paid",
          durationBasis: "scheduled_work",
          entitlementMethod: "annual",
          annualUnits: 10,
          eligibility: { basis: "hire_date", completedServiceMonths: 0 },
          prorationMethod: "none",
          roundingIncrement: 1,
          carryover: { mode: "none" },
          conversion: { allowed: false },
        },
      }),
    ).rejects.toThrow("Shared-pool organizations require company policies to use the company leave pool");
  });

  it("detects and normalizes legacy mixed company policies without deleting history", async () => {
    const { t, actor, organizationId } = await setupOrganization();
    await actor.mutation(configureLeaveSector, {
      organizationId,
      employmentSector: "private",
      effectiveStart: manilaDate(2039, 1, 1),
      changeReason: "Initial pooled setup",
    });
    const legacy = await t.run(async (ctx) => {
      const user = await ctx.db
        .query("users")
        .withIndex("by_email", (query) =>
          query.eq("email", "leave-policy-owner@example.com"),
        )
        .unique();
      if (!user) throw new Error("Owner missing");
      const policyId = await ctx.db.insert("leavePolicies", {
        organizationId,
        sourceKey: "company_legacy_sick",
        name: "Legacy Sick Leave",
        category: "company",
        confidentiality: "standard",
        state: "active",
        createdBy: user._id,
        createdAt: 1,
        updatedAt: 1,
      });
      const versionId = await ctx.db.insert("leavePolicyVersions", {
        organizationId,
        leavePolicyId: policyId,
        version: 1,
        effectiveStart: manilaDate(2039, 1, 1),
        accountBehavior: "individual_account",
        payTreatment: "company_paid",
        durationBasis: "scheduled_work",
        entitlementMethod: "annual",
        annualUnits: 5,
        eligibilityBasis: "hire_date",
        completedServiceMonths: 0,
        prorationMethod: "none",
        roundingIncrement: 1,
        carryoverMode: "none",
        conversionAllowed: false,
        createdBy: user._id,
        createdAt: 1,
        changeReason: "Legacy mixed model",
      });
      return { policyId, versionId };
    });

    await expect(
      actor.query(getCompanyLeaveModel, {
        organizationId,
        asOf: manilaDate(2039, 6, 1),
      }),
    ).resolves.toMatchObject({
      effectiveMode: "pooled",
      requiresNormalization: true,
    });
    await actor.mutation(scheduleCompanyLeaveModelChange, {
      organizationId,
      mode: "pooled",
      effectiveStart: manilaDate(2040, 1, 1),
      changeReason: "Normalize historical mixed policies",
    });
    const versions = await t.run((ctx) =>
      ctx.db
        .query("leavePolicyVersions")
        .withIndex("by_policy_effective", (query) =>
          query.eq("leavePolicyId", legacy.policyId),
        )
        .collect(),
    );
    expect(versions).toEqual([
      expect.objectContaining({
        _id: legacy.versionId,
        accountBehavior: "individual_account",
        effectiveEnd: manilaDate(2040, 1, 1) - 1,
      }),
      expect.objectContaining({
        accountBehavior: "shared_pool",
        poolKey: "company_leave",
        effectiveStart: manilaDate(2040, 1, 1),
      }),
    ]);
  });

  it("prevents multiple base entitlements from double-granting the shared pool", async () => {
    const { actor, organizationId } = await setupOrganization();
    await actor.mutation(configureLeaveSector, {
      organizationId,
      employmentSector: "private",
      effectiveStart: manilaDate(2039, 1, 1),
      changeReason: "Initial pooled setup",
    });
    const pooledRules: LeavePolicyRules = {
      accountBehavior: "shared_pool",
      poolKey: "company_leave",
      payTreatment: "company_paid",
      durationBasis: "scheduled_work",
      entitlementMethod: "annual",
      annualUnits: 15,
      eligibility: { basis: "hire_date", completedServiceMonths: 0 },
      prorationMethod: "none",
      roundingIncrement: 1,
      carryover: { mode: "none" },
      conversion: { allowed: false },
    };
    await actor.mutation(createCompanyLeavePolicy, {
      organizationId,
      name: "General Leave",
      sourceKey: "company_general_leave",
      effectiveStart: manilaDate(2039, 1, 1),
      changeReason: "Create base pool",
      rules: pooledRules,
    });

    await expect(
      actor.mutation(createCompanyLeavePolicy, {
        organizationId,
        name: "Sick Leave",
        sourceKey: "company_sick",
        effectiveStart: manilaDate(2039, 1, 1),
        changeReason: "Accidental second entitlement",
        rules: { ...pooledRules, annualUnits: 5 },
      }),
    ).rejects.toThrow(
      "Shared annual pool can have only one base entitlement policy",
    );
  });

  it("configures anniversary leave as pooled or by-type according to the effective company model", async () => {
    const { actor, organizationId } = await setupOrganization();
    await actor.mutation(configureLeaveSector, {
      organizationId,
      employmentSector: "private",
      effectiveStart: manilaDate(2039, 1, 1),
      changeReason: "Initial pooled setup",
    });

    const pooled = await actor.mutation(configureAnniversaryLeave, {
      organizationId,
      enabled: true,
      maximumDays: 5,
      serviceDateBasis: "hire_date",
      effectiveStart: manilaDate(2039, 1, 1),
      changeReason: "Add anniversary bonus",
    });
    await actor.mutation(scheduleCompanyLeaveModelChange, {
      organizationId,
      mode: "by_type",
      effectiveStart: manilaDate(2040, 1, 1),
      changeReason: "Use separate balances",
    });
    const configuration = await actor.query(getLeaveConfiguration, {
      organizationId,
    });
    const anniversary = configuration.policies.find(
      ({ policy }) => policy._id === pooled.policyId,
    );

    expect(configuration.settings).toMatchObject({
      enableAnniversaryLeave: true,
      anniversaryLeaveMaxDays: 5,
      anniversaryLeaveServiceDateBasis: "hire_date",
    });
    expect(anniversary?.policy).toMatchObject({
      sourceKey: "company_anniversary_leave",
      name: "Anniversary Leave",
      category: "company",
    });
    expect(anniversary?.versions).toEqual([
      expect.objectContaining({
        accountBehavior: "shared_pool",
        poolKey: "company_leave",
        entitlementMethod: "anniversary",
        annualUnits: 5,
        eligibilityBasis: "hire_date",
        effectiveEnd: manilaDate(2040, 1, 1) - 1,
      }),
      expect.objectContaining({
        accountBehavior: "individual_account",
        entitlementMethod: "anniversary",
        annualUnits: 5,
        effectiveStart: manilaDate(2040, 1, 1),
      }),
    ]);
    expect(anniversary?.versions[1]?.poolKey).toBeUndefined();
  });

  it("restores each prior by-type entitlement after a temporary shared-pool period", async () => {
    const { actor, organizationId } = await setupOrganization();
    await actor.mutation(configureLeaveSector, {
      organizationId,
      employmentSector: "private",
      effectiveStart: manilaDate(2039, 1, 1),
      changeReason: "Initial pooled setup",
    });
    await actor.mutation(scheduleCompanyLeaveModelChange, {
      organizationId,
      mode: "by_type",
      effectiveStart: manilaDate(2040, 1, 1),
      changeReason: "Start with separate balances",
    });
    const rules = (annualUnits: number): LeavePolicyRules => ({
      accountBehavior: "individual_account",
      payTreatment: "company_paid",
      durationBasis: "scheduled_work",
      entitlementMethod: "annual",
      annualUnits,
      eligibility: { basis: "hire_date", completedServiceMonths: 0 },
      prorationMethod: "none",
      roundingIncrement: 1,
      carryover: { mode: "none" },
      conversion: { allowed: false },
    });
    const vacation = await actor.mutation(createCompanyLeavePolicy, {
      organizationId,
      name: "Vacation Leave",
      sourceKey: "company_vacation",
      effectiveStart: manilaDate(2040, 1, 1),
      changeReason: "Create vacation entitlement",
      rules: rules(10),
    });
    const sick = await actor.mutation(createCompanyLeavePolicy, {
      organizationId,
      name: "Sick Leave",
      sourceKey: "company_sick",
      effectiveStart: manilaDate(2040, 1, 1),
      changeReason: "Create sick entitlement",
      rules: rules(5),
    });
    await actor.mutation(scheduleCompanyLeaveModelChange, {
      organizationId,
      mode: "pooled",
      effectiveStart: manilaDate(2041, 1, 1),
      changeReason: "Temporarily combine balances",
    });
    await actor.mutation(scheduleCompanyLeaveModelChange, {
      organizationId,
      mode: "by_type",
      effectiveStart: manilaDate(2042, 1, 1),
      changeReason: "Restore separate balances",
    });

    const configuration = await actor.query(getLeaveConfiguration, {
      organizationId,
    });
    const vacationVersions = configuration.policies.find(
      ({ policy }) => policy._id === vacation.leavePolicyId,
    )?.versions;
    const sickVersions = configuration.policies.find(
      ({ policy }) => policy._id === sick.leavePolicyId,
    )?.versions;

    expect(vacationVersions?.at(-1)).toMatchObject({
      accountBehavior: "individual_account",
      entitlementMethod: "annual",
      annualUnits: 10,
      effectiveStart: manilaDate(2042, 1, 1),
    });
    expect(sickVersions?.at(-1)).toMatchObject({
      accountBehavior: "individual_account",
      entitlementMethod: "annual",
      annualUnits: 5,
      effectiveStart: manilaDate(2042, 1, 1),
    });
  });

  it("initializes a new private organization with the protected five-day SIL policy", async () => {
    const { t, actor, organizationId } = await setupOrganization();

    await actor.mutation(configureLeaveSector, {
      organizationId,
      employmentSector: "private",
      effectiveStart: 100,
      changeReason: "Initial private-sector policy setup",
    });

    const configuration = await actor.query(getLeaveConfiguration, {
      organizationId,
    });
    const sil = configuration.policies.find(
      ({ policy }) => policy.sourceKey === "private_sil",
    );

    expect(configuration.settings).toMatchObject({
      employmentSector: "private",
      migrationState: "active",
      activePolicyEngineVersion: 2,
    });
    expect(sil).toMatchObject({
      policy: {
        complianceRole: "private_sil_minimum",
        state: "active",
      },
      versions: [
        expect.objectContaining({
          version: 1,
          effectiveStart: 100,
          annualUnits: 5,
          completedServiceMonths: 12,
        }),
      ],
    });

    const persisted = await t.run((ctx) =>
      ctx.db
        .query("leavePolicies")
        .withIndex("by_organization_source_key", (q) =>
          q.eq("organizationId", organizationId).eq("sourceKey", "private_sil"),
        )
        .unique(),
    );
    expect(persisted?._id).toBe(sil?.policy._id);
  });

  it("restores missing statutory presets idempotently without replacing existing versions", async () => {
    const { t, actor, organizationId } = await setupOrganization();
    await actor.mutation(configureLeaveSector, {
      organizationId,
      employmentSector: "private",
      effectiveStart: 100,
      changeReason: "Initial setup",
    });
    const before = await actor.query(getLeaveConfiguration, { organizationId });
    const paternity = before.policies.find(
      ({ policy }) => policy.sourceKey === "private_paternity",
    );
    if (!paternity) throw new Error("Paternity preset missing");
    await t.run(async (ctx) => {
      for (const version of paternity.versions) await ctx.db.delete(version._id);
      await ctx.db.delete(paternity.policy._id);
    });

    await expect(
      actor.mutation(synchronizeStatutoryPolicies, { organizationId }),
    ).resolves.toMatchObject({ createdPolicyCount: 1 });
    await expect(
      actor.mutation(synchronizeStatutoryPolicies, { organizationId }),
    ).resolves.toEqual({ createdPolicyCount: 0, coveredPolicyCount: 0 });

    const after = await actor.query(getLeaveConfiguration, { organizationId });
    expect(
      after.policies.find(({ policy }) => policy.sourceKey === "private_sil")
        ?.versions,
    ).toEqual(
      before.policies.find(({ policy }) => policy.sourceKey === "private_sil")
        ?.versions,
    );
    expect(
      after.policies.find(
        ({ policy }) => policy.sourceKey === "private_paternity",
      ),
    ).toBeDefined();
  });

  it("initializes government vacation and sick leave as separate monthly accounts", async () => {
    const { actor, organizationId } = await setupOrganization();

    await actor.mutation(configureLeaveSector, {
      organizationId,
      employmentSector: "government",
      effectiveStart: 200,
      changeReason: "Initial government policy setup",
    });

    const configuration = await actor.query(getLeaveConfiguration, {
      organizationId,
    });
    const vacation = configuration.policies.find(
      ({ policy }) => policy.sourceKey === "government_vacation",
    );
    const sick = configuration.policies.find(
      ({ policy }) => policy.sourceKey === "government_sick",
    );

    for (const configured of [vacation, sick]) {
      expect(configured?.versions[0]).toMatchObject({
        accountBehavior: "individual_account",
        entitlementMethod: "monthly",
        annualUnits: 15,
        accrualRate: 1.25,
      });
    }
    expect(vacation?.policy._id).not.toBe(sick?.policy._id);
  });

  it("requires monthly policy changes to start on a Manila month boundary", async () => {
    const { actor, organizationId } = await setupOrganization();
    await actor.mutation(configureLeaveSector, {
      organizationId,
      employmentSector: "government",
      effectiveStart: manilaDate(2026, 1, 1),
      changeReason: "Initial government policy setup",
    });
    const configuration = await actor.query(getLeaveConfiguration, {
      organizationId,
    });
    const vacation = configuration.policies.find(
      ({ policy }) => policy.sourceKey === "government_vacation",
    );
    const preset = buildGovernmentPreset().policies.find(
      (policy) => policy.sourceKey === "government_vacation",
    );
    if (!vacation || !preset) throw new Error("Government vacation policy missing");

    await expect(
      actor.mutation(createLeavePolicyVersion, {
        organizationId,
        leavePolicyId: vacation.policy._id,
        effectiveStart: manilaDate(2026, 2, 15),
        changeReason: "Invalid mid-month policy change",
        rules: preset.rules,
      }),
    ).rejects.toThrow("first day of a Manila month");
    await expect(
      actor.mutation(createLeavePolicyVersion, {
        organizationId,
        leavePolicyId: vacation.policy._id,
        effectiveStart: manilaDate(2026, 3, 1),
        changeReason: "Valid monthly policy change",
        rules: preset.rules,
      }),
    ).resolves.toMatchObject({ version: 2 });
  });

  it("creates a later immutable version and rejects overlaps or statutory reductions", async () => {
    const { t, actor, organizationId } = await setupOrganization();
    await actor.mutation(configureLeaveSector, {
      organizationId,
      employmentSector: "private",
      effectiveStart: 100,
      changeReason: "Initial setup",
    });
    const policy = await t.run((ctx) =>
      ctx.db
        .query("leavePolicies")
        .withIndex("by_organization_source_key", (q) =>
          q.eq("organizationId", organizationId).eq("sourceKey", "private_sil"),
        )
        .unique(),
    );
    if (!policy) throw new Error("Private SIL policy was not created");
    const original = await t.run((ctx) =>
      ctx.db
        .query("leavePolicyVersions")
        .withIndex("by_policy_version", (q) =>
          q.eq("leavePolicyId", policy._id).eq("version", 1),
        )
        .unique(),
    );

    const created = await actor.mutation(createLeavePolicyVersion, {
      organizationId,
      leavePolicyId: policy._id,
      effectiveStart: 200,
      changeReason: "Increase annual SIL benefit",
      rules: moreGenerousPrivateSil,
    });
    const versions = await t.run((ctx) =>
      ctx.db
        .query("leavePolicyVersions")
        .withIndex("by_policy_effective", (q) =>
          q.eq("leavePolicyId", policy._id),
        )
        .collect(),
    );

    expect(created.version).toBe(2);
    expect(versions).toHaveLength(2);
    expect(versions[0]).toEqual({ ...original, effectiveEnd: 199 });
    expect(versions[1]).toMatchObject({ version: 2, annualUnits: 8 });
    await expect(
      actor.mutation(createLeavePolicyVersion, {
        organizationId,
        leavePolicyId: policy._id,
        effectiveStart: 200,
        changeReason: "Conflicting effective date",
        rules: moreGenerousPrivateSil,
      }),
    ).rejects.toThrow("later than the current version");
    await expect(
      actor.mutation(createLeavePolicyVersion, {
        organizationId,
        leavePolicyId: policy._id,
        effectiveStart: 300,
        changeReason: "Reduce below the statutory floor",
        rules: { ...moreGenerousPrivateSil, annualUnits: 4 },
      }),
    ).rejects.toThrow("statutory annual entitlement");
  });

  it("creates by-type company leave after the organization model changes", async () => {
    const { actor, organizationId } = await setupOrganization();
    await actor.mutation(configureLeaveSector, {
      organizationId,
      employmentSector: "private",
      effectiveStart: manilaDate(2026, 1, 1),
      changeReason: "Initial setup",
    });
    await actor.mutation(scheduleCompanyLeaveModelChange, {
      organizationId,
      mode: "by_type",
      effectiveStart: manilaDate(2040, 1, 1),
      changeReason: "Use separate leave balances",
    });
    const vacationRules: LeavePolicyRules = {
      accountBehavior: "individual_account",
      payTreatment: "company_paid",
      durationBasis: "scheduled_work",
      entitlementMethod: "annual",
      annualUnits: 10,
      eligibility: { basis: "hire_date", completedServiceMonths: 0 },
      prorationMethod: "calendar_months",
      roundingIncrement: 0.5,
      carryover: { mode: "capped", capUnits: 5 },
      conversion: { allowed: false },
    };
    const created = await actor.mutation(createCompanyLeavePolicy, {
      organizationId,
      name: "Vacation Leave",
      sourceKey: "company_vacation",
      effectiveStart: manilaDate(2040, 1, 1),
      changeReason: "Add separate vacation balance",
      rules: vacationRules,
    });
    const configuration = await actor.query(getLeaveConfiguration, {
      organizationId,
    });

    expect(created.version).toBe(1);
    expect(
      configuration.policies.find(
        ({ policy }) => policy._id === created.leavePolicyId,
      ),
    ).toMatchObject({
      policy: { category: "company", sourceKey: "company_vacation" },
      versions: [
        expect.objectContaining({
          accountBehavior: "individual_account",
          annualUnits: 10,
          prorationMethod: "calendar_months",
        }),
      ],
    });
    await expect(
      actor.mutation(createCompanyLeavePolicy, {
        organizationId,
        name: "Duplicate vacation",
        sourceKey: "company_vacation",
        effectiveStart: manilaDate(2040, 2, 1),
        changeReason: "Duplicate",
        rules: vacationRules,
      }),
    ).rejects.toThrow("source key already exists");
  });

  it("archives a company policy without deleting its historical request", async () => {
    const { t, actor, organizationId } = await setupOrganization();
    const fixture = await t.run(async (ctx) => {
      const user = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", "leave-policy-owner@example.com"))
        .unique();
      if (!user) throw new Error("Owner fixture missing");
      const policyId = await ctx.db.insert("leavePolicies", {
        organizationId,
        sourceKey: "company_birthday",
        name: "Birthday Leave",
        category: "company",
        confidentiality: "standard",
        state: "active",
        createdBy: user._id,
        createdAt: 1,
        updatedAt: 1,
      });
      const policyVersionId = await ctx.db.insert("leavePolicyVersions", {
        organizationId,
        leavePolicyId: policyId,
        version: 1,
        effectiveStart: 10,
        accountBehavior: "individual_account",
        payTreatment: "company_paid",
        durationBasis: "scheduled_work",
        entitlementMethod: "annual",
        annualUnits: 1,
        eligibilityBasis: "hire_date",
        completedServiceMonths: 0,
        prorationMethod: "none",
        roundingIncrement: 1,
        carryoverMode: "none",
        conversionAllowed: false,
        createdBy: user._id,
        createdAt: 1,
        changeReason: "Initial company policy",
      });
      const employeeId = await ctx.db.insert("employees", {
        organizationId,
        personalInfo: {
          firstName: "Policy",
          lastName: "Employee",
          email: "policy.employee@example.com",
        },
        employment: {
          employeeId: "POLICY-001",
          position: "Analyst",
          department: "People",
          employmentType: "regular",
          hireDate: 1,
          status: "active",
        },
        compensation: { basicSalary: 30_000, salaryType: "monthly" },
        schedule: {
          defaultSchedule: Object.fromEntries(
            [
              "monday",
              "tuesday",
              "wednesday",
              "thursday",
              "friday",
              "saturday",
              "sunday",
            ].map((day) => [
              day,
              { in: "09:00", out: "18:00", isWorkday: day !== "sunday" },
            ]),
          ) as Doc<"employees">["schedule"]["defaultSchedule"],
        },
        createdAt: 1,
        updatedAt: 1,
      });
      const requestId = await ctx.db.insert("leaveRequests", {
        organizationId,
        employeeId,
        leaveType: "custom",
        customLeaveType: "company_birthday",
        startDate: 20,
        endDate: 20,
        numberOfDays: 1,
        reason: "Birthday",
        status: "approved",
        policyId,
        policyVersionId,
        filedDate: 15,
        createdAt: 15,
        updatedAt: 15,
      });
      return { policyId, policyVersionId, requestId };
    });

    await expect(
      actor.mutation(archiveLeavePolicy, {
        organizationId,
        leavePolicyId: fixture.policyId,
        effectiveEnd: 50,
        reason: "Benefit retired",
      }),
    ).resolves.toEqual({ archived: true });
    const persisted = await t.run(async (ctx) => ({
      policy: await ctx.db.get(fixture.policyId),
      version: await ctx.db.get(fixture.policyVersionId),
      request: await ctx.db.get(fixture.requestId),
    }));
    expect(persisted.policy).toMatchObject({ state: "archived" });
    expect(persisted.version).toMatchObject({ effectiveEnd: 50 });
    expect(persisted.request?._id).toBe(fixture.requestId);
  });

  it("previews persisted impact without changing policy history", async () => {
    const { t, actor, organizationId } = await setupOrganization();
    await actor.mutation(configureLeaveSector, {
      organizationId,
      employmentSector: "private",
      effectiveStart: 100,
      changeReason: "Initial setup",
    });
    const configuration = await actor.query(getLeaveConfiguration, {
      organizationId,
    });
    const sil = configuration.policies.find(
      ({ policy }) => policy.sourceKey === "private_sil",
    );
    if (!sil) throw new Error("Private SIL configuration missing");
    await t.run(async (ctx) => {
      const employeeId = await ctx.db.insert("employees", {
        organizationId,
        personalInfo: {
          firstName: "Impact",
          lastName: "Employee",
          email: "impact.employee@example.com",
        },
        employment: {
          employeeId: "IMPACT-001",
          position: "Analyst",
          department: "People",
          employmentType: "regular",
          hireDate: 1,
          status: "active",
        },
        compensation: { basicSalary: 30_000, salaryType: "monthly" },
        schedule: {
          defaultSchedule: {
            monday: { in: "09:00", out: "18:00", isWorkday: true },
            tuesday: { in: "09:00", out: "18:00", isWorkday: true },
            wednesday: { in: "09:00", out: "18:00", isWorkday: true },
            thursday: { in: "09:00", out: "18:00", isWorkday: true },
            friday: { in: "09:00", out: "18:00", isWorkday: true },
            saturday: { in: "09:00", out: "18:00", isWorkday: false },
            sunday: { in: "09:00", out: "18:00", isWorkday: false },
          },
        },
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("employeeLeaveBalances", {
        organizationId,
        employeeId,
        policyId: sil.policy._id,
        policyVersionId: sil.versions[0]._id,
        poolKey: "company_leave",
        periodStart: 100,
        periodEnd: 500,
        year: 2026,
        leaveTypeKey: "private_sil",
        total: 5,
        used: 0,
        balance: 5,
        source: "employee_credits",
        approvedDays: 0,
        reconciliationStatus: "matching",
        migrationVersion: 2,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("leaveRequests", {
        organizationId,
        employeeId,
        leaveType: "vacation",
        startDate: 300,
        endDate: 300,
        numberOfDays: 1,
        reason: "Planned leave",
        status: "pending",
        policyId: sil.policy._id,
        policyVersionId: sil.versions[0]._id,
        requestedStart: 300,
        requestedEnd: 300,
        filedDate: 250,
        createdAt: 250,
        updatedAt: 250,
      });
    });

    const impact = await actor.query(previewLeavePolicyImpact, {
      organizationId,
      leavePolicyId: sil.policy._id,
      effectiveStart: 200,
      rules: moreGenerousPrivateSil,
    });

    expect(impact).toMatchObject({
      nextVersion: 2,
      affectedBalanceCount: 1,
      affectedRequestCount: 1,
    });
    expect(sil.versions).toHaveLength(1);
  });

  it("denies manager writes and keeps legacy settings writes while marking comparison pending", async () => {
    const manager = await setupOrganization("manager");
    await expect(
      manager.actor.mutation(configureLeaveSector, {
        organizationId: manager.organizationId,
        employmentSector: "private",
        effectiveStart: 100,
        changeReason: "Manager attempt",
      }),
    ).rejects.toThrow("Owner access is required");

    const owner = await setupOrganization();
    await owner.t.run((ctx) =>
      ctx.db.insert("organizationLeaveSettings", {
        organizationId: owner.organizationId,
        migrationState: "awaiting_sector_confirmation",
        annualSil: 5,
        migrationVersion: 1,
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    await expect(
      owner.actor.mutation(updateLeaveTypes, {
        organizationId: owner.organizationId,
        annualSil: 9,
        leaveTrackerMode: "general",
        leaveTypes: [
          {
            type: "vacation",
            name: "Vacation Leave",
            defaultCredits: 9,
            isPaid: true,
            requiresApproval: true,
          },
        ],
      }),
    ).resolves.toEqual({ success: true });
    const legacy = await owner.t.run(async (ctx) => ({
      settings: await ctx.db
        .query("organizationLeaveSettings")
        .withIndex("by_organization", (q) =>
          q.eq("organizationId", owner.organizationId),
        )
        .unique(),
      leaveType: await ctx.db
        .query("leaveTypes")
        .withIndex("by_organization", (q) =>
          q.eq("organizationId", owner.organizationId),
        )
        .unique(),
    }));
    expect(legacy.settings).toMatchObject({
      annualSil: 9,
      leaveTrackerMode: "general",
      migrationState: "pending",
    });
    expect(legacy.settings?.activePolicyEngineVersion).toBeUndefined();
    expect(legacy.leaveType).toMatchObject({
      sourceKey: "vacation",
      defaultCredits: 9,
    });
  });
});
