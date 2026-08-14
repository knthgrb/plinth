import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import type { Doc, Id } from "../convex/_generated/dataModel";
import schema from "../convex/schema";

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

type RequestPreview = {
  policy: {
    policyId: Id<"leavePolicies">;
    policyVersionId: Id<"leavePolicyVersions">;
    name: string;
    payTreatment: Doc<"leavePolicyVersions">["payTreatment"];
  };
  requestedStart: number;
  requestedEnd: number;
  chargeableDuration: number;
  availableBalance: number | null;
  remainingBalance: number | null;
  occurrences: Array<{
    localDate: string;
    scheduledMinutes: number;
    leaveMinutes: number;
    creditAmount: number;
    isHoliday: boolean;
    isRestDay: boolean;
  }>;
};

type CreateRequestArgs = {
  organizationId: Id<"organizations">;
  employeeId: Id<"employees">;
  policyId: Id<"leavePolicies">;
  startLocalDate: string;
  endLocalDate: string;
  requestedDurationMode: "day" | "half_day" | "hour";
  requestedMinutes?: number;
  reason: string;
  benefitEventId?: Id<"leaveBenefitEvents">;
  attachments?: Array<{
    storageObjectId: Id<"storageObjects">;
    documentType: string;
  }>;
};

const previewLeaveRequestV2 = makeFunctionReference<
  "query",
  Omit<CreateRequestArgs, "reason" | "attachments">,
  RequestPreview
>("leave:previewLeaveRequestV2");

const createLeaveRequestV2 = makeFunctionReference<
  "mutation",
  CreateRequestArgs,
  { leaveRequestId: Id<"leaveRequests">; chargeableDuration: number }
>("leave:createLeaveRequestV2");

const createWithPayOverride = makeFunctionReference<
  "mutation",
  CreateRequestArgs & { payTreatment: "unpaid" },
  { leaveRequestId: Id<"leaveRequests">; chargeableDuration: number }
>("leave:createLeaveRequestV2");

const getMyLeaveDashboard = makeFunctionReference<
  "query",
  { organizationId: Id<"organizations"> },
  {
    pendingRequestCount: number;
    balances: Array<{ available: number; reserved: number }>;
  }
>("leave:getMyLeaveDashboard");

const getMyLeaveRequests = makeFunctionReference<
  "query",
  {
    organizationId: Id<"organizations">;
    paginationOpts: { numItems: number; cursor: string | null };
  },
  {
    page: Array<Doc<"leaveRequests"> & { supportingDocuments: Id<"_storage">[] }>;
    isDone: boolean;
    continueCursor: string;
  }
>("leave:getMyLeaveRequests");

const workday = { in: "09:00", out: "18:00", isWorkday: true };
const restDay = { in: "09:00", out: "18:00", isWorkday: false };
const defaultSchedule: Doc<"employees">["schedule"]["defaultSchedule"] = {
  monday: workday,
  tuesday: workday,
  wednesday: workday,
  thursday: workday,
  friday: workday,
  saturday: restDay,
  sunday: restDay,
};

async function setupFixture() {
  const t = convexTest(schema, modules);
  const email = "leave-v2-employee@example.com";
  const fixture = await t.run(async (ctx) => {
    const organizationId = await ctx.db.insert("organizations", {
      name: "Leave V2 Organization",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    const employeeUserId = await ctx.db.insert("users", {
      email,
      createdAt: 1,
      updatedAt: 1,
    });
    const approverUserId = await ctx.db.insert("users", {
      email: "leave-v2-hr@example.com",
      createdAt: 1,
      updatedAt: 1,
    });
    const employeeId = await ctx.db.insert("employees", {
      organizationId,
      personalInfo: {
        firstName: "Leave",
        lastName: "Employee",
        email,
      },
      employment: {
        employeeId: "LEAVE-V2-001",
        position: "Analyst",
        department: "People",
        employmentType: "regular",
        hireDate: manilaDate(2020, 1, 1),
        status: "active",
      },
      compensation: { basicSalary: 30_000, salaryType: "monthly" },
      schedule: { defaultSchedule },
      createdAt: 1,
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
    await ctx.db.insert("userOrganizations", {
      userId: approverUserId,
      organizationId,
      role: "hr",
      accessStatus: "active",
      joinedAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("organizationLeaveSettings", {
      organizationId,
      employmentSector: "private",
      policyYearBasis: "calendar_year",
      requestPrecision: "half_day",
      migrationState: "active",
      activePolicyEngineVersion: 2,
      policyEngineCutoverAt: manilaDate(2026, 1, 1),
      migrationVersion: 2,
      createdAt: 1,
      updatedAt: 1,
    });

    const vacationPolicyId = await ctx.db.insert("leavePolicies", {
      organizationId,
      sourceKey: "company_vacation",
      name: "Vacation Leave",
      category: "company",
      confidentiality: "standard",
      state: "active",
      createdBy: approverUserId,
      createdAt: 1,
      updatedAt: 1,
    });
    const vacationVersionId = await ctx.db.insert("leavePolicyVersions", {
      organizationId,
      leavePolicyId: vacationPolicyId,
      version: 1,
      effectiveStart: manilaDate(2026, 1, 1),
      accountBehavior: "individual_account",
      payTreatment: "company_paid",
      durationBasis: "scheduled_work",
      entitlementMethod: "annual",
      annualUnits: 2,
      eligibilityBasis: "hire_date",
      completedServiceMonths: 0,
      prorationMethod: "none",
      roundingIncrement: 0.5,
      carryoverMode: "none",
      conversionAllowed: false,
      createdBy: approverUserId,
      createdAt: 1,
      changeReason: "Test vacation policy",
    });
    const balanceId = await ctx.db.insert("employeeLeaveBalances", {
      organizationId,
      employeeId,
      policyId: vacationPolicyId,
      policyVersionId: vacationVersionId,
      periodStart: manilaDate(2026, 1, 1),
      periodEnd: manilaDate(2026, 12, 31),
      granted: 2,
      reserved: 0,
      converted: 0,
      expired: 0,
      projectionVersion: 1,
      engineStatus: "open",
      year: 2026,
      leaveTypeKey: "company_vacation",
      total: 2,
      used: 0,
      balance: 2,
      source: "employee_credits",
      approvedDays: 0,
      reconciliationStatus: "matching",
      migrationVersion: 2,
      createdAt: 1,
      updatedAt: 1,
    });

    const maternityPolicyId = await ctx.db.insert("leavePolicies", {
      organizationId,
      sourceKey: "private_maternity",
      name: "Maternity Leave",
      category: "statutory",
      confidentiality: "restricted",
      state: "active",
      createdBy: approverUserId,
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("leavePolicyVersions", {
      organizationId,
      leavePolicyId: maternityPolicyId,
      version: 1,
      effectiveStart: manilaDate(2026, 1, 1),
      accountBehavior: "non_credit",
      payTreatment: "statutory_benefit_supported",
      durationBasis: "calendar_days",
      entitlementMethod: "event_based",
      eligibilityBasis: "event",
      completedServiceMonths: 0,
      prorationMethod: "none",
      roundingIncrement: 1,
      carryoverMode: "none",
      conversionAllowed: false,
      qualifyingEventRequired: true,
      createdBy: approverUserId,
      createdAt: 1,
      changeReason: "Test maternity policy",
    });
    const maternityEventId = await ctx.db.insert("leaveBenefitEvents", {
      organizationId,
      employeeId,
      eventType: "maternity",
      qualifyingDate: manilaDate(2026, 9, 7),
      verificationStatus: "verified",
      verifiedBy: approverUserId,
      verifiedAt: 1,
      createdBy: employeeUserId,
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("holidays", {
      organizationId,
      name: "Applicable Monday holiday",
      date: manilaDate(2026, 9, 7),
      type: "regular",
      isRecurring: false,
      year: 2026,
      applyToAll: true,
      createdAt: 1,
      updatedAt: 1,
    });
    return {
      organizationId,
      employeeId,
      vacationPolicyId,
      vacationVersionId,
      maternityPolicyId,
      maternityEventId,
      balanceId,
      approverUserId,
    };
  });
  return { t, actor: t.withIdentity({ email }), ...fixture };
}

describe("leave request V2 lifecycle", () => {
  it("previews schedule-aware, half-day, and calendar-day leave with authoritative policy pay", async () => {
    const fixture = await setupFixture();
    const common = {
      organizationId: fixture.organizationId,
      employeeId: fixture.employeeId,
      policyId: fixture.vacationPolicyId,
      startLocalDate: "2026-09-04",
      endLocalDate: "2026-09-07",
      requestedDurationMode: "day" as const,
    };

    const working = await fixture.actor.query(previewLeaveRequestV2, common);
    const halfDay = await fixture.actor.query(previewLeaveRequestV2, {
      ...common,
      startLocalDate: "2026-09-04",
      endLocalDate: "2026-09-04",
      requestedDurationMode: "half_day",
    });
    await expect(
      fixture.actor.query(previewLeaveRequestV2, {
        ...common,
        policyId: fixture.maternityPolicyId,
        startLocalDate: "2026-09-04",
        endLocalDate: "2026-09-07",
      }),
    ).rejects.toThrow("verified qualifying event");
    const calendar = await fixture.actor.query(previewLeaveRequestV2, {
      ...common,
      policyId: fixture.maternityPolicyId,
      startLocalDate: "2026-09-04",
      endLocalDate: "2026-09-07",
      benefitEventId: fixture.maternityEventId,
    });

    expect(working).toMatchObject({
      requestedStart: manilaDate(2026, 9, 4),
      requestedEnd: manilaDate(2026, 9, 7),
      chargeableDuration: 1,
      availableBalance: 2,
      remainingBalance: 1,
      policy: { payTreatment: "company_paid" },
    });
    expect(working.occurrences).toEqual([
      expect.objectContaining({ localDate: "2026-09-04", creditAmount: 1 }),
      expect.objectContaining({ localDate: "2026-09-05", creditAmount: 0, isRestDay: true }),
      expect.objectContaining({ localDate: "2026-09-06", creditAmount: 0, isRestDay: true }),
      expect.objectContaining({ localDate: "2026-09-07", creditAmount: 0, isHoliday: true }),
    ]);
    expect(halfDay).toMatchObject({ chargeableDuration: 0.5 });
    expect(calendar).toMatchObject({
      chargeableDuration: 4,
      availableBalance: null,
      remainingBalance: null,
      policy: { payTreatment: "statutory_benefit_supported" },
    });
  });

  it("atomically persists occurrences, reservation, audit event, attachments, and approver notification", async () => {
    const fixture = await setupFixture();
    const storageObjectId = await fixture.t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob(["medical evidence"]));
      return ctx.db.insert("storageObjects", {
        storageId,
        organizationId: fixture.organizationId,
        ownerUserId: await ctx.db
          .query("users")
          .withIndex("by_email", (query) =>
            query.eq("email", "leave-v2-employee@example.com"),
          )
          .unique()
          .then((user) => {
            if (!user) throw new Error("Employee user missing");
            return user._id;
          }),
        purpose: "leave_attachment",
        state: "active",
        createdAt: 1,
        updatedAt: 1,
      });
    });

    const created = await fixture.actor.mutation(createLeaveRequestV2, {
      organizationId: fixture.organizationId,
      employeeId: fixture.employeeId,
      policyId: fixture.vacationPolicyId,
      startLocalDate: "2026-09-04",
      endLocalDate: "2026-09-04",
      requestedDurationMode: "half_day",
      reason: "Personal appointment",
      attachments: [{ storageObjectId, documentType: "supporting_document" }],
    });
    const state = await fixture.t.run(async (ctx) => ({
      request: await ctx.db.get(created.leaveRequestId),
      balance: await ctx.db.get(fixture.balanceId),
      occurrences: await ctx.db
        .query("leaveRequestOccurrences")
        .withIndex("by_request_local_date", (query) =>
          query.eq("leaveRequestId", created.leaveRequestId),
        )
        .collect(),
      ledger: await ctx.db
        .query("leaveLedgerEntries")
        .withIndex("by_request", (query) =>
          query.eq("leaveRequestId", created.leaveRequestId),
        )
        .collect(),
      events: await ctx.db
        .query("leaveRequestEvents")
        .withIndex("by_request_created", (query) =>
          query.eq("leaveRequestId", created.leaveRequestId),
        )
        .collect(),
      links: await ctx.db
        .query("storageObjectLinks")
        .withIndex("by_parent", (query) =>
          query.eq("parentType", "leave_request").eq("parentId", created.leaveRequestId),
        )
        .collect(),
      notifications: await ctx.db
        .query("notifications")
        .withIndex("by_user_org_created", (query) =>
          query
            .eq("userId", fixture.approverUserId)
            .eq("organizationId", fixture.organizationId),
        )
        .collect(),
    }));

    expect(created.chargeableDuration).toBe(0.5);
    expect(state.request).toMatchObject({
      policyId: fixture.vacationPolicyId,
      policyVersionId: fixture.vacationVersionId,
      status: "pending",
      chargeableDuration: 0.5,
      payTreatment: "company_paid",
      engineVersion: 2,
    });
    expect(state.balance).toMatchObject({ reserved: 0.5, balance: 1.5 });
    expect(state.occurrences).toHaveLength(1);
    expect(state.ledger).toEqual([
      expect.objectContaining({ kind: "reservation", amount: -0.5 }),
    ]);
    expect(state.events).toEqual([
      expect.objectContaining({ type: "submitted" }),
      expect.objectContaining({ type: "notification_sent" }),
    ]);
    expect(state.links).toHaveLength(1);
    expect(state.notifications).toHaveLength(1);
  });

  it("rejects pay overrides and prevents pending reservations from exceeding availability", async () => {
    const fixture = await setupFixture();
    const base = {
      organizationId: fixture.organizationId,
      employeeId: fixture.employeeId,
      policyId: fixture.vacationPolicyId,
      startLocalDate: "2026-09-08",
      endLocalDate: "2026-09-08",
      requestedDurationMode: "day" as const,
      reason: "First request",
    };

    await expect(
      fixture.actor.mutation(createWithPayOverride, {
        ...base,
        payTreatment: "unpaid",
      }),
    ).rejects.toThrow();
    await fixture.actor.mutation(createLeaveRequestV2, base);
    await fixture.actor.mutation(createLeaveRequestV2, {
      ...base,
      startLocalDate: "2026-09-09",
      endLocalDate: "2026-09-09",
      reason: "Second request",
    });
    await expect(
      fixture.actor.mutation(createLeaveRequestV2, {
        ...base,
        startLocalDate: "2026-09-10",
        endLocalDate: "2026-09-10",
        reason: "Overbooked request",
      }),
    ).rejects.toThrow("Insufficient leave balance");
  });

  it("enforces qualifications, submission evidence, overlap, and active employment", async () => {
    const fixture = await setupFixture();
    const qualificationPolicyId = await fixture.t.run(async (ctx) => {
      const policyId = await ctx.db.insert("leavePolicies", {
        organizationId: fixture.organizationId,
        sourceKey: "private_solo_parent",
        name: "Solo Parent Leave",
        category: "statutory",
        confidentiality: "restricted",
        state: "active",
        createdBy: fixture.approverUserId,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("leavePolicyVersions", {
        organizationId: fixture.organizationId,
        leavePolicyId: policyId,
        version: 1,
        effectiveStart: manilaDate(2026, 1, 1),
        accountBehavior: "non_credit",
        payTreatment: "statutory_paid",
        durationBasis: "scheduled_work",
        entitlementMethod: "annual",
        annualUnits: 7,
        eligibilityBasis: "verified_qualification",
        completedServiceMonths: 6,
        prorationMethod: "none",
        roundingIncrement: 1,
        carryoverMode: "none",
        conversionAllowed: false,
        createdBy: fixture.approverUserId,
        createdAt: 1,
        changeReason: "Test qualification policy",
      });
      await ctx.db.patch(fixture.vacationVersionId, {
        requiredDocumentRules: [
          {
            documentType: "medical_certificate",
            minimumDuration: 1,
            requiredBefore: "submission",
          },
        ],
      });
      return policyId;
    });
    const common = {
      organizationId: fixture.organizationId,
      employeeId: fixture.employeeId,
      startLocalDate: "2026-09-08",
      endLocalDate: "2026-09-08",
      requestedDurationMode: "day" as const,
    };

    await expect(
      fixture.actor.query(previewLeaveRequestV2, {
        ...common,
        policyId: qualificationPolicyId,
      }),
    ).rejects.toThrow("verified leave qualification");
    await expect(
      fixture.actor.mutation(createLeaveRequestV2, {
        ...common,
        policyId: fixture.vacationPolicyId,
        reason: "Missing evidence",
      }),
    ).rejects.toThrow("medical_certificate");

    await fixture.t.run((ctx) =>
      ctx.db.patch(fixture.vacationVersionId, {
        requiredDocumentRules: undefined,
      }),
    );
    await fixture.actor.mutation(createLeaveRequestV2, {
      ...common,
      policyId: fixture.vacationPolicyId,
      reason: "Original request",
    });
    await expect(
      fixture.actor.mutation(createLeaveRequestV2, {
        ...common,
        policyId: fixture.vacationPolicyId,
        reason: "Overlapping request",
      }),
    ).rejects.toThrow("already has a pending leave request");

    await fixture.t.run((ctx) =>
      ctx.db.patch(fixture.employeeId, {
        employment: {
          employeeId: "LEAVE-V2-001",
          position: "Analyst",
          department: "People",
          employmentType: "regular",
          hireDate: manilaDate(2020, 1, 1),
          status: "resigned",
        },
      }),
    );
    await expect(
      fixture.actor.query(previewLeaveRequestV2, {
        ...common,
        policyId: fixture.vacationPolicyId,
        startLocalDate: "2026-09-09",
        endLocalDate: "2026-09-09",
      }),
    ).rejects.toThrow("Separated or inactive employees");
  });

  it("bounds request spans and enforces a qualifying-event cap across requests", async () => {
    const fixture = await setupFixture();
    await fixture.t.run(async (ctx) => {
      const version = await ctx.db
        .query("leavePolicyVersions")
        .withIndex("by_policy_version", (query) =>
          query.eq("leavePolicyId", fixture.maternityPolicyId).eq("version", 1),
        )
        .unique();
      if (!version) throw new Error("Maternity policy version missing");
      await ctx.db.patch(version._id, { maximumUnitsPerEvent: 4 });
    });

    await expect(
      fixture.actor.query(previewLeaveRequestV2, {
        organizationId: fixture.organizationId,
        employeeId: fixture.employeeId,
        policyId: fixture.maternityPolicyId,
        startLocalDate: "2026-01-01",
        endLocalDate: "2027-02-01",
        requestedDurationMode: "day",
        benefitEventId: fixture.maternityEventId,
      }),
    ).rejects.toThrow("maximum supported span");

    await fixture.actor.mutation(createLeaveRequestV2, {
      organizationId: fixture.organizationId,
      employeeId: fixture.employeeId,
      policyId: fixture.maternityPolicyId,
      startLocalDate: "2026-09-04",
      endLocalDate: "2026-09-07",
      requestedDurationMode: "day",
      benefitEventId: fixture.maternityEventId,
      reason: "Initial event entitlement",
    });
    await expect(
      fixture.actor.mutation(createLeaveRequestV2, {
        organizationId: fixture.organizationId,
        employeeId: fixture.employeeId,
        policyId: fixture.maternityPolicyId,
        startLocalDate: "2026-09-08",
        endLocalDate: "2026-09-08",
        requestedDurationMode: "day",
        benefitEventId: fixture.maternityEventId,
        reason: "Duplicate event entitlement",
      }),
    ).rejects.toThrow("qualifying-event limit");
  });

  it("returns the employee dashboard and a bounded request page", async () => {
    const fixture = await setupFixture();
    await fixture.actor.mutation(createLeaveRequestV2, {
      organizationId: fixture.organizationId,
      employeeId: fixture.employeeId,
      policyId: fixture.vacationPolicyId,
      startLocalDate: "2026-09-08",
      endLocalDate: "2026-09-08",
      requestedDurationMode: "day",
      reason: "Dashboard request",
    });

    const [dashboard, page] = await Promise.all([
      fixture.actor.query(getMyLeaveDashboard, {
        organizationId: fixture.organizationId,
      }),
      fixture.actor.query(getMyLeaveRequests, {
        organizationId: fixture.organizationId,
        paginationOpts: { numItems: 1, cursor: null },
      }),
    ]);

    expect(dashboard).toMatchObject({
      pendingRequestCount: 1,
      balances: [expect.objectContaining({ available: 1, reserved: 1 })],
    });
    expect(page.page).toHaveLength(1);
    expect(page.page[0]).toMatchObject({
      policyId: fixture.vacationPolicyId,
      supportingDocuments: [],
    });
  });
});
