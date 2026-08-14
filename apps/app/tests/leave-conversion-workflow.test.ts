import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import type { Doc, Id } from "../convex/_generated/dataModel";
import type { MutationCtx } from "../convex/_generated/server";
import schema from "../convex/schema";

const rawModules = import.meta.glob("../convex/**/*.ts");
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => [
    path.replace("../convex/", "./"),
    loader,
  ]),
);

type ConversionFixture = {
  organizationId: Id<"organizations">;
  ownerId: Id<"users">;
  employeeUserId: Id<"users">;
  employeeId: Id<"employees">;
  balanceId: Id<"employeeLeaveBalances">;
  policyId: Id<"leavePolicies">;
  policyVersionId: Id<"leavePolicyVersions">;
};

type ConversionQueueRow = Doc<"leaveConversionRequests"> & {
  employeeName: string;
  policyName: string;
};

const requestLeaveConversion = makeFunctionReference<
  "mutation",
  {
    organizationId: Id<"organizations">;
    balanceId: Id<"employeeLeaveBalances">;
    requestedDays: number;
  },
  Id<"leaveConversionRequests">
>("leaveConversions:requestLeaveConversion");

const approveLeaveConversion = makeFunctionReference<
  "mutation",
  {
    organizationId: Id<"organizations">;
    conversionRequestId: Id<"leaveConversionRequests">;
    decisionReason?: string;
  },
  { approved: true }
>("leaveConversions:approveLeaveConversion");

const cancelLeaveConversion = makeFunctionReference<
  "mutation",
  {
    organizationId: Id<"organizations">;
    conversionRequestId: Id<"leaveConversionRequests">;
    reason: string;
  },
  { cancelled: true }
>("leaveConversions:cancelLeaveConversion");

const getLeaveConversionQueue = makeFunctionReference<
  "query",
  { organizationId: Id<"organizations">; status?: "pending" | "approved" },
  ConversionQueueRow[]
>("leaveConversions:getLeaveConversionQueue");

const prepareFinalSettlement = makeFunctionReference<
  "mutation",
  {
    organizationId: Id<"organizations">;
    employeeId: Id<"employees">;
  },
  Id<"finalSettlements">
>("finalSettlements:prepareFinalSettlement");

type ConversionAmountRow = {
  employeeId: Id<"employees">;
  convertibleDays: number;
  dailyRate: number;
  leaveConversionAmount: number;
};

const computeLeaveConversionAmounts = makeFunctionReference<
  "query",
  {
    organizationId: Id<"organizations">;
    year: number;
    employeeIds?: Id<"employees">[];
  },
  ConversionAmountRow[]
>("payroll:computeLeaveConversionAmounts");

const createLeaveConversionRun = makeFunctionReference<
  "mutation",
  {
    organizationId: Id<"organizations">;
    year: number;
    employeeIds: Id<"employees">[];
  },
  Id<"payrollRuns">
>("payroll:createLeaveConversionRun");

const updatePayrollRunStatus = makeFunctionReference<
  "mutation",
  {
    payrollRunId: Id<"payrollRuns">;
    status: "draft" | "finalized" | "paid" | "archived" | "cancelled";
  },
  { success: boolean }
>("payroll:updatePayrollRunStatus");

const schedule: Doc<"employees">["schedule"]["defaultSchedule"] = {
  monday: { in: "09:00", out: "18:00", isWorkday: true },
  tuesday: { in: "09:00", out: "18:00", isWorkday: true },
  wednesday: { in: "09:00", out: "18:00", isWorkday: true },
  thursday: { in: "09:00", out: "18:00", isWorkday: true },
  friday: { in: "09:00", out: "18:00", isWorkday: true },
  saturday: { in: "09:00", out: "18:00", isWorkday: false },
  sunday: { in: "09:00", out: "18:00", isWorkday: false },
};

async function seedFixture(ctx: MutationCtx): Promise<ConversionFixture> {
  const organizationId = await ctx.db.insert("organizations", {
    name: "Conversion Test Organization",
    status: "active",
    createdAt: 1,
    updatedAt: 1,
  });
  const ownerId = await ctx.db.insert("users", {
    email: "conversion.owner@example.com",
    createdAt: 1,
    updatedAt: 1,
  });
  const employeeUserId = await ctx.db.insert("users", {
    email: "conversion.employee@example.com",
    createdAt: 1,
    updatedAt: 1,
  });
  const employeeId = await ctx.db.insert("employees", {
    organizationId,
    personalInfo: {
      firstName: "Connie",
      lastName: "Version",
      email: "conversion.employee@example.com",
    },
    employment: {
      employeeId: "CONV-001",
      position: "Analyst",
      department: "People",
      employmentType: "regular",
      hireDate: 1,
      status: "active",
    },
    compensation: {
      basicSalary: 30_000,
      allowance: 3_000,
      salaryType: "monthly",
    },
    schedule: { defaultSchedule: schedule },
    createdAt: 1,
    updatedAt: 1,
  });
  await ctx.db.insert("userOrganizations", {
    userId: ownerId,
    organizationId,
    role: "owner",
    accessStatus: "active",
    joinedAt: 1,
    updatedAt: 1,
  });
  await ctx.db.insert("userOrganizations", {
    userId: employeeUserId,
    organizationId,
    employeeId,
    role: "employee",
    accessStatus: "active",
    joinedAt: 1,
    updatedAt: 1,
  });
  await ctx.db.insert("organizationLeaveSettings", {
    organizationId,
    employmentSector: "private",
    policyYearBasis: "calendar_year",
    migrationState: "active",
    activePolicyEngineVersion: 2,
    migrationVersion: 2,
    createdAt: 1,
    updatedAt: 1,
  });
  await ctx.db.insert("organizationPayrollSettings", {
    organizationId,
    salaryPaymentFrequency: "bimonthly",
    firstPayDate: 15,
    secondPayDate: 30,
    payrollSettings: {
      dailyRateIncludesAllowance: false,
      dailyRateWorkingDaysPerYear: 261,
    },
    migrationVersion: 1,
    createdAt: 1,
    updatedAt: 1,
  });
  const policyId = await ctx.db.insert("leavePolicies", {
    organizationId,
    sourceKey: "private_sil",
    name: "Service Incentive Leave",
    category: "statutory",
    confidentiality: "standard",
    state: "active",
    complianceRole: "private_sil_minimum",
    createdBy: ownerId,
    createdAt: 1,
    updatedAt: 1,
  });
  const policyVersionId = await ctx.db.insert("leavePolicyVersions", {
    organizationId,
    leavePolicyId: policyId,
    version: 1,
    effectiveStart: 1,
    accountBehavior: "individual_account",
    payTreatment: "company_paid",
    durationBasis: "scheduled_work",
    entitlementMethod: "annual",
    annualUnits: 5,
    eligibilityBasis: "hire_date",
    completedServiceMonths: 12,
    prorationMethod: "none",
    roundingIncrement: 0.25,
    carryoverMode: "unlimited",
    conversionAllowed: true,
    maxConvertibleUnits: 2,
    createdBy: ownerId,
    createdAt: 1,
    changeReason: "Test policy",
  });
  const balanceId = await ctx.db.insert("employeeLeaveBalances", {
    organizationId,
    employeeId,
    policyId,
    policyVersionId,
    periodStart: 1,
    periodEnd: 4_102_444_800_000,
    year: 2026,
    leaveTypeKey: "private_sil",
    granted: 5,
    reserved: 0,
    converted: 0,
    expired: 0,
    projectionVersion: 1,
    engineStatus: "open",
    total: 5,
    used: 0,
    balance: 5,
    source: "legacy_tracker",
    approvedDays: 0,
    reconciliationStatus: "matching",
    migrationVersion: 2,
    createdAt: 1,
    updatedAt: 1,
  });
  return {
    organizationId,
    ownerId,
    employeeUserId,
    employeeId,
    balanceId,
    policyId,
    policyVersionId,
  };
}

async function setup() {
  const t = convexTest(schema, modules);
  const fixture = await t.run(seedFixture);
  return {
    t,
    fixture,
    owner: t.withIdentity({ email: "conversion.owner@example.com" }),
    employee: t.withIdentity({ email: "conversion.employee@example.com" }),
  };
}

describe("leave conversion workflow", () => {
  it("enforces the policy cap before creating a pending conversion request", async () => {
    const { employee, fixture } = await setup();

    await expect(
      employee.mutation(requestLeaveConversion, {
        organizationId: fixture.organizationId,
        balanceId: fixture.balanceId,
        requestedDays: 2.25,
      }),
    ).rejects.toThrow("conversion cap");

    await expect(
      employee.mutation(requestLeaveConversion, {
        organizationId: fixture.organizationId,
        balanceId: fixture.balanceId,
        requestedDays: 2,
      }),
    ).resolves.toBeDefined();

    await expect(
      employee.mutation(requestLeaveConversion, {
        organizationId: fixture.organizationId,
        balanceId: fixture.balanceId,
        requestedDays: 0.25,
      }),
    ).rejects.toThrow("conversion cap");
  });

  it("approves against a daily-rate snapshot and posts conversion without increasing used leave", async () => {
    const { t, owner, employee, fixture } = await setup();
    const requestId = await employee.mutation(requestLeaveConversion, {
      organizationId: fixture.organizationId,
      balanceId: fixture.balanceId,
      requestedDays: 2,
    });

    await owner.mutation(approveLeaveConversion, {
      organizationId: fixture.organizationId,
      conversionRequestId: requestId,
      decisionReason: "Approved for annual conversion",
    });

    const result = await t.run(async (ctx) => ({
      request: await ctx.db.get(requestId),
      balance: await ctx.db.get(fixture.balanceId),
      ledger: await ctx.db
        .query("leaveLedgerEntries")
        .withIndex("by_organization_idempotency_key", (query) =>
          query
            .eq("organizationId", fixture.organizationId)
            .eq("idempotencyKey", `leave-conversion:${requestId}:approval`),
        )
        .unique(),
    }));

    expect(result.request).toMatchObject({
      status: "approved",
      paymentStatus: "ready",
      dailyRateSnapshot: 1379.31,
      payableAmount: 2758.62,
    });
    expect(result.ledger).toMatchObject({
      kind: "conversion",
      amount: -2,
      leaveConversionRequestId: requestId,
    });
    expect(result.balance).toMatchObject({
      balance: 3,
      used: 0,
      converted: 2,
    });
    await expect(
      owner.query(computeLeaveConversionAmounts, {
        organizationId: fixture.organizationId,
        year: 2026,
        employeeIds: [fixture.employeeId],
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        employeeId: fixture.employeeId,
        convertibleDays: 2,
        dailyRate: 1379.31,
        leaveConversionAmount: 2758.62,
      }),
    ]);
  });

  it("returns a named HR queue and restores availability when cancelled before payroll finalization", async () => {
    const { t, owner, employee, fixture } = await setup();
    const requestId = await employee.mutation(requestLeaveConversion, {
      organizationId: fixture.organizationId,
      balanceId: fixture.balanceId,
      requestedDays: 1,
    });
    await owner.mutation(approveLeaveConversion, {
      organizationId: fixture.organizationId,
      conversionRequestId: requestId,
    });

    const queue = await owner.query(getLeaveConversionQueue, {
      organizationId: fixture.organizationId,
      status: "approved",
    });
    expect(queue[0]).toMatchObject({
      _id: requestId,
      employeeName: "Connie Version",
      policyName: "Service Incentive Leave",
    });

    await owner.mutation(cancelLeaveConversion, {
      organizationId: fixture.organizationId,
      conversionRequestId: requestId,
      reason: "Employee withdrew the request",
    });
    const result = await t.run(async (ctx) => ({
      request: await ctx.db.get(requestId),
      balance: await ctx.db.get(fixture.balanceId),
      reversal: await ctx.db
        .query("leaveLedgerEntries")
        .withIndex("by_organization_idempotency_key", (query) =>
          query
            .eq("organizationId", fixture.organizationId)
            .eq("idempotencyKey", `leave-conversion:${requestId}:cancellation`),
        )
        .unique(),
    }));
    expect(result.request).toMatchObject({
      status: "cancelled",
      paymentStatus: "cancelled",
    });
    expect(result.reversal).toMatchObject({ kind: "adjustment", amount: 1 });
    expect(result.balance).toMatchObject({ balance: 5, used: 0 });
    await expect(
      employee.mutation(requestLeaveConversion, {
        organizationId: fixture.organizationId,
        balanceId: fixture.balanceId,
        requestedDays: 2,
      }),
    ).resolves.toBeDefined();
  });

  it("links active employees to a draft conversion run and locks cancellation when finalized", async () => {
    const { t, owner, employee, fixture } = await setup();
    const requestId = await employee.mutation(requestLeaveConversion, {
      organizationId: fixture.organizationId,
      balanceId: fixture.balanceId,
      requestedDays: 1,
    });
    await owner.mutation(approveLeaveConversion, {
      organizationId: fixture.organizationId,
      conversionRequestId: requestId,
    });

    const payrollRunId = await owner.mutation(createLeaveConversionRun, {
      organizationId: fixture.organizationId,
      year: 2026,
      employeeIds: [fixture.employeeId],
    });
    expect(await t.run((ctx) => ctx.db.get(requestId))).toMatchObject({
      payrollRunId,
      paymentStatus: "processing",
    });

    await owner.mutation(updatePayrollRunStatus, {
      payrollRunId,
      status: "finalized",
    });
    await expect(
      owner.mutation(cancelLeaveConversion, {
        organizationId: fixture.organizationId,
        conversionRequestId: requestId,
        reason: "Too late",
      }),
    ).rejects.toThrow("finalized payroll");

    await owner.mutation(updatePayrollRunStatus, {
      payrollRunId,
      status: "paid",
    });
    expect(await t.run((ctx) => ctx.db.get(requestId))).toMatchObject({
      status: "paid",
      paymentStatus: "paid",
    });
  });

  it("links separated employees to final settlement and routes unlocked future leave for cancellation", async () => {
    const { t, owner, fixture } = await setup();
    await t.run(async (ctx) => {
      const employee = await ctx.db.get(fixture.employeeId);
      if (!employee) throw new Error("Employee missing");
      await ctx.db.patch(fixture.employeeId, {
        employment: {
          ...employee.employment,
          status: "resigned",
          separationDate: 2_000,
          lastWorkingDay: 2_000,
        },
      });
      await ctx.db.insert("leaveRequests", {
        organizationId: fixture.organizationId,
        employeeId: fixture.employeeId,
        leaveType: "vacation",
        startDate: 3_000,
        endDate: 3_000,
        numberOfDays: 1,
        reason: "Future leave",
        status: "approved",
        policyId: fixture.policyId,
        policyVersionId: fixture.policyVersionId,
        filedDate: 1_000,
        createdAt: 1_000,
        updatedAt: 1_000,
      });
    });
    const settlementId = await owner.mutation(prepareFinalSettlement, {
      organizationId: fixture.organizationId,
      employeeId: fixture.employeeId,
    });

    const requestId = await owner.mutation(requestLeaveConversion, {
      organizationId: fixture.organizationId,
      balanceId: fixture.balanceId,
      requestedDays: 1,
    });
    await owner.mutation(approveLeaveConversion, {
      organizationId: fixture.organizationId,
      conversionRequestId: requestId,
    });

    const result = await t.run(async (ctx) => ({
      conversion: await ctx.db.get(requestId),
      balance: await ctx.db.get(fixture.balanceId),
      futureRequest: await ctx.db
        .query("leaveRequests")
        .withIndex("by_employee", (query) =>
          query.eq("employeeId", fixture.employeeId),
        )
        .unique(),
      events: await ctx.db
        .query("leaveRequestEvents")
        .withIndex("by_organization_created", (query) =>
          query.eq("organizationId", fixture.organizationId),
        )
        .collect(),
    }));
    expect(result.conversion).toMatchObject({
      finalSettlementId: settlementId,
      paymentStatus: "ready",
    });
    expect(result.balance).toMatchObject({ engineStatus: "closed" });
    expect(result.futureRequest).toMatchObject({
      status: "cancellation_requested",
      cancellationReason: "Employment separation",
    });
    expect(result.events).toEqual([
      expect.objectContaining({ type: "cancellation_requested" }),
    ]);
  });
});
