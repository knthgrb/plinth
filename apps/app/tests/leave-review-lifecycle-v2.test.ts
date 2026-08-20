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

type RequestArgs = {
  organizationId: Id<"organizations">;
  employeeId: Id<"employees">;
  policyId: Id<"leavePolicies">;
  startLocalDate: string;
  endLocalDate: string;
  requestedDurationMode: "day" | "half_day" | "hour";
  requestedMinutes?: number;
  reason: string;
};

const createLeaveRequestV2 = makeFunctionReference<
  "mutation",
  RequestArgs,
  { leaveRequestId: Id<"leaveRequests">; chargeableDuration: number }
>("leave:createLeaveRequestV2");
const approveLeaveRequestV2 = makeFunctionReference<
  "mutation",
  { leaveRequestId: Id<"leaveRequests">; decisionReason?: string },
  { status: "approved" }
>("leave:approveLeaveRequestV2");
const rejectLeaveRequestV2 = makeFunctionReference<
  "mutation",
  { leaveRequestId: Id<"leaveRequests">; decisionReason: string },
  { status: "rejected" }
>("leave:rejectLeaveRequestV2");
const withdrawPendingLeaveRequest = makeFunctionReference<
  "mutation",
  { leaveRequestId: Id<"leaveRequests">; reason?: string },
  { status: "cancelled" }
>("leave:withdrawPendingLeaveRequest");
const requestApprovedLeaveCancellation = makeFunctionReference<
  "mutation",
  { leaveRequestId: Id<"leaveRequests">; reason: string },
  { status: "cancellation_requested" }
>("leave:requestApprovedLeaveCancellation");
const approveLeaveCancellation = makeFunctionReference<
  "mutation",
  { leaveRequestId: Id<"leaveRequests">; reason: string },
  { status: "cancelled" }
>("leave:approveLeaveCancellation");
const correctProcessedLeave = makeFunctionReference<
  "mutation",
  { leaveRequestId: Id<"leaveRequests">; reason: string },
  { status: "corrected" }
>("leave:correctProcessedLeave");
const adjustLeaveBalance = makeFunctionReference<
  "mutation",
  {
    balanceId: Id<"employeeLeaveBalances">;
    amount: number;
    effectiveDate: number;
    reason: string;
  },
  { balanceId: Id<"employeeLeaveBalances">; available: number }
>("leave:adjustLeaveBalance");
const recordManualLeaveV2 = makeFunctionReference<
  "mutation",
  RequestArgs & { decisionReason: string },
  { leaveRequestId: Id<"leaveRequests">; status: "approved" }
>("leave:recordManualLeaveV2");
const getLeaveReviewContext = makeFunctionReference<
  "query",
  { leaveRequestId: Id<"leaveRequests"> },
  {
    request: Doc<"leaveRequests">;
    occurrences: Doc<"leaveRequestOccurrences">[];
    balance: { available: number; reserved: number } | null;
  }
>("leave:getLeaveReviewContext");
const getLeaveApprovalInbox = makeFunctionReference<
  "query",
  {
    organizationId: Id<"organizations">;
    paginationOpts: { numItems: number; cursor: string | null };
  },
  { page: Doc<"leaveRequests">[]; isDone: boolean; continueCursor: string }
>("leave:getLeaveApprovalInbox");
const getLeaveBalanceAdministration = makeFunctionReference<
  "query",
  {
    organizationId: Id<"organizations">;
    year: number;
    paginationOpts: { numItems: number; cursor: string | null };
  },
  {
    page: Array<{
      balanceId: Id<"employeeLeaveBalances">;
      employeeName: string;
      policyName: string;
      available: number;
    }>;
    isDone: boolean;
    continueCursor: string;
  }
>("leave:getLeaveBalanceAdministration");
const getLeaveBalanceLedgerEntries = makeFunctionReference<
  "query",
  {
    balanceId: Id<"employeeLeaveBalances">;
    paginationOpts: { numItems: number; cursor: string | null };
  },
  {
    page: Array<{
      id: Id<"leaveLedgerEntries">;
      kind: string;
      amount: number;
      actorName?: string;
      reason?: string;
    }>;
    isDone: boolean;
    continueCursor: string;
  }
>("leave:getLeaveBalanceLedgerEntries");
const getApprovedLeaveCalendar = makeFunctionReference<
  "query",
  {
    organizationId: Id<"organizations">;
    startLocalDate: string;
    endLocalDate: string;
    paginationOpts: { numItems: number; cursor: string | null };
  },
  {
    page: Array<{
      leaveRequestId: Id<"leaveRequests">;
      employeeName: string;
      policyName: string;
      reason?: string;
      status: "approved";
    }>;
    isDone: boolean;
    continueCursor: string;
  }
>("leave:getApprovedLeaveCalendar");

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
  const fixture = await t.run(async (ctx) => {
    const organizationId = await ctx.db.insert("organizations", {
      name: "Leave Review Organization",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    const requesterUserId = await ctx.db.insert("users", {
      email: "leave-review-requester@example.com",
      name: "Riley Requester",
      createdAt: 1,
      updatedAt: 1,
    });
    const ownerUserId = await ctx.db.insert("users", {
      email: "leave-review-owner@example.com",
      name: "Olivia Owner",
      createdAt: 1,
      updatedAt: 1,
    });
    const adminUserId = await ctx.db.insert("users", {
      email: "leave-review-admin@example.com",
      name: "Amir Admin",
      createdAt: 1,
      updatedAt: 1,
    });
    const managerUserId = await ctx.db.insert("users", {
      email: "leave-review-manager@example.com",
      name: "Morgan Manager",
      createdAt: 1,
      updatedAt: 1,
    });
    const employeeId = await ctx.db.insert("employees", {
      organizationId,
      personalInfo: {
        firstName: "Riley",
        lastName: "Requester",
        email: "leave-review-requester@example.com",
      },
      employment: {
        employeeId: "REVIEW-001",
        position: "HR Specialist",
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
    for (const membership of [
      { userId: requesterUserId, role: "hr" as const, employeeId },
      { userId: ownerUserId, role: "owner" as const },
      { userId: adminUserId, role: "admin" as const },
      { userId: managerUserId, role: "manager" as const },
    ]) {
      await ctx.db.insert("userOrganizations", {
        ...membership,
        organizationId,
        accessStatus: "active",
        joinedAt: 1,
        updatedAt: 1,
      });
    }
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
    const policyId = await ctx.db.insert("leavePolicies", {
      organizationId,
      sourceKey: "company_vacation",
      name: "Vacation Leave",
      category: "company",
      confidentiality: "standard",
      state: "active",
      createdBy: ownerUserId,
      createdAt: 1,
      updatedAt: 1,
    });
    const policyVersionId = await ctx.db.insert("leavePolicyVersions", {
      organizationId,
      leavePolicyId: policyId,
      version: 1,
      effectiveStart: manilaDate(2026, 1, 1),
      accountBehavior: "individual_account",
      payTreatment: "company_paid",
      durationBasis: "scheduled_work",
      entitlementMethod: "annual",
      annualUnits: 10,
      eligibilityBasis: "hire_date",
      completedServiceMonths: 0,
      prorationMethod: "none",
      roundingIncrement: 0.5,
      carryoverMode: "none",
      conversionAllowed: false,
      createdBy: ownerUserId,
      createdAt: 1,
      changeReason: "Test review policy",
    });
    const balanceId = await ctx.db.insert("employeeLeaveBalances", {
      organizationId,
      employeeId,
      policyId,
      policyVersionId,
      periodStart: manilaDate(2026, 1, 1),
      periodEnd: manilaDate(2026, 12, 31),
      granted: 10,
      reserved: 0,
      converted: 0,
      expired: 0,
      projectionVersion: 1,
      engineStatus: "open",
      year: 2026,
      leaveTypeKey: "company_vacation",
      total: 10,
      used: 0,
      balance: 10,
      source: "employee_credits",
      approvedDays: 0,
      reconciliationStatus: "matching",
      migrationVersion: 2,
      createdAt: 1,
      updatedAt: 1,
    });
    return {
      organizationId,
      requesterUserId,
      ownerUserId,
      adminUserId,
      employeeId,
      policyId,
      policyVersionId,
      balanceId,
    };
  });
  return {
    t,
    ...fixture,
    requester: t.withIdentity({ email: "leave-review-requester@example.com" }),
    owner: t.withIdentity({ email: "leave-review-owner@example.com" }),
    admin: t.withIdentity({ email: "leave-review-admin@example.com" }),
    manager: t.withIdentity({ email: "leave-review-manager@example.com" }),
  };
}

function requestArgs(
  fixture: Awaited<ReturnType<typeof setupFixture>>,
  localDate: string,
): RequestArgs {
  return {
    organizationId: fixture.organizationId,
    employeeId: fixture.employeeId,
    policyId: fixture.policyId,
    startLocalDate: localDate,
    endLocalDate: localDate,
    requestedDurationMode: "day",
    reason: `Leave on ${localDate}`,
  };
}

describe("leave V2 final review lifecycle", () => {
  it("redacts restricted requests server-side until the reviewer has an active grant", async () => {
    const fixture = await setupFixture();
    const created = await fixture.requester.mutation(
      createLeaveRequestV2,
      requestArgs(fixture, "2026-09-07"),
    );
    await fixture.t.run(async (ctx) => {
      await ctx.db.patch(fixture.policyId, { confidentiality: "restricted" });
    });

    const redacted = await fixture.owner.query(getLeaveApprovalInbox, {
      organizationId: fixture.organizationId,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(JSON.stringify(redacted.page[0])).not.toContain(
      "Leave on 2026-09-07",
    );
    expect(redacted.page[0]).toMatchObject({
      reason: "Restricted leave details",
      policyName: "Protected leave",
      hasSensitiveAccess: false,
    });
    await expect(
      fixture.owner.query(getLeaveReviewContext, {
        leaveRequestId: created.leaveRequestId,
      }),
    ).rejects.toThrow("Not authorized");

    await fixture.t.run(async (ctx) => {
      const membership = await ctx.db
        .query("userOrganizations")
        .withIndex("by_user_organization", (query) =>
          query
            .eq("userId", fixture.ownerUserId)
            .eq("organizationId", fixture.organizationId),
        )
        .unique();
      if (!membership) throw new Error("Owner membership missing");
      await ctx.db.insert("leaveSensitiveAccessGrants", {
        organizationId: fixture.organizationId,
        membershipId: membership._id,
        isActive: true,
        grantedBy: fixture.adminUserId,
        grantedAt: Date.now(),
      });
    });
    const visible = await fixture.owner.query(getLeaveApprovalInbox, {
      organizationId: fixture.organizationId,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(visible.page[0]).toMatchObject({
      reason: "Leave on 2026-09-07",
      hasSensitiveAccess: true,
    });
    await expect(
      fixture.owner.query(getLeaveReviewContext, {
        leaveRequestId: created.leaveRequestId,
      }),
    ).resolves.toMatchObject({ request: { reason: "Leave on 2026-09-07" } });
  });

  it("paginates enriched balances and their append-only ledger for administrators", async () => {
    const fixture = await setupFixture();
    await fixture.t.run((ctx) =>
      ctx.db.insert("employeeLeaveBalances", {
        organizationId: fixture.organizationId,
        employeeId: fixture.employeeId,
        year: 2026,
        leaveTypeKey: "vacation",
        total: 10,
        used: 0,
        balance: 10,
        source: "employee_credits",
        approvedDays: 0,
        reconciliationStatus: "not_applicable",
        migrationVersion: 1,
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    await fixture.owner.mutation(adjustLeaveBalance, {
      balanceId: fixture.balanceId,
      amount: 1.5,
      effectiveDate: manilaDate(2026, 8, 1),
      reason: "Correct opening balance",
    });

    const balances = await fixture.owner.query(getLeaveBalanceAdministration, {
      organizationId: fixture.organizationId,
      year: 2026,
      paginationOpts: { numItems: 20, cursor: null },
    });
    const ledger = await fixture.owner.query(getLeaveBalanceLedgerEntries, {
      balanceId: fixture.balanceId,
      paginationOpts: { numItems: 20, cursor: null },
    });

    expect(balances.page).toEqual([
      expect.objectContaining({
        balanceId: fixture.balanceId,
        employeeName: "Riley Requester",
        policyName: "Vacation Leave",
        available: 11.5,
      }),
    ]);
    expect(ledger.page[0]).toEqual(
      expect.objectContaining({
        kind: "adjustment",
        amount: 1.5,
        actorName: "Olivia Owner",
        reason: "Correct opening balance",
      }),
    );
  });

  it("approves once, consumes the reservation, and snapshots the authenticated reviewer", async () => {
    const fixture = await setupFixture();
    const created = await fixture.requester.mutation(
      createLeaveRequestV2,
      requestArgs(fixture, "2026-09-08"),
    );
    const occurrenceId = await fixture.t.run(async (ctx) => {
      const occurrence = await ctx.db
        .query("leaveRequestOccurrences")
        .withIndex("by_request_local_date", (query) =>
          query.eq("leaveRequestId", created.leaveRequestId),
        )
        .unique();
      if (!occurrence) throw new Error("Leave occurrence missing");
      await ctx.db.patch(occurrence._id, {
        attendanceConflictState: "detected",
      });
      await ctx.db.patch(fixture.policyVersionId, {
        requiredDocumentRules: [
          {
            documentType: "medical_certificate",
            requiredBefore: "approval",
          },
        ],
      });
      return occurrence._id;
    });

    await expect(
      fixture.requester.mutation(approveLeaveRequestV2, {
        leaveRequestId: created.leaveRequestId,
      }),
    ).rejects.toThrow("cannot approve your own");
    await expect(
      fixture.manager.mutation(approveLeaveRequestV2, {
        leaveRequestId: created.leaveRequestId,
      }),
    ).rejects.toThrow("Owner, Admin, or HR approval is required");

    const inbox = await fixture.owner.query(getLeaveApprovalInbox, {
      organizationId: fixture.organizationId,
      paginationOpts: { numItems: 10, cursor: null },
    });
    const context = await fixture.owner.query(getLeaveReviewContext, {
      leaveRequestId: created.leaveRequestId,
    });
    expect(inbox.page.map((request) => request._id)).toContain(
      created.leaveRequestId,
    );
    expect(inbox.page[0]).toMatchObject({
      employeeName: "Riley Requester",
      policyName: "Vacation Leave",
      requiredDocumentCount: 1,
      submittedDocumentCount: 0,
      hasConflict: true,
    });
    expect(context).toMatchObject({
      request: { status: "pending" },
      balance: { available: 9, reserved: 1 },
    });
    await fixture.t.run(async (ctx) => {
      await ctx.db.patch(occurrenceId, { attendanceConflictState: "none" });
      await ctx.db.patch(fixture.policyVersionId, {
        requiredDocumentRules: [],
      });
    });

    await expect(
      fixture.owner.mutation(approveLeaveRequestV2, {
        leaveRequestId: created.leaveRequestId,
        decisionReason: "Coverage confirmed",
      }),
    ).resolves.toEqual({ status: "approved" });
    await expect(
      fixture.owner.mutation(approveLeaveRequestV2, {
        leaveRequestId: created.leaveRequestId,
      }),
    ).rejects.toThrow("no longer pending");

    const calendar = await fixture.owner.query(getApprovedLeaveCalendar, {
      organizationId: fixture.organizationId,
      startLocalDate: "2026-09-01",
      endLocalDate: "2026-09-30",
      paginationOpts: { numItems: 20, cursor: null },
    });
    expect(calendar.page).toEqual([
      expect.objectContaining({
        leaveRequestId: created.leaveRequestId,
        employeeName: "Riley Requester",
        policyName: "Vacation Leave",
        reason: "Leave on 2026-09-08",
        status: "approved",
      }),
    ]);

    const state = await fixture.t.run(async (ctx) => ({
      request: await ctx.db.get(created.leaveRequestId),
      balance: await ctx.db.get(fixture.balanceId),
      ledger: await ctx.db
        .query("leaveLedgerEntries")
        .withIndex("by_request", (query) =>
          query.eq("leaveRequestId", created.leaveRequestId),
        )
        .collect(),
      occurrences: await ctx.db
        .query("leaveRequestOccurrences")
        .withIndex("by_request_local_date", (query) =>
          query.eq("leaveRequestId", created.leaveRequestId),
        )
        .collect(),
    }));
    expect(state.request).toMatchObject({
      status: "approved",
      reviewerId: fixture.ownerUserId,
      reviewerSnapshot: { displayName: "Olivia Owner" },
      decisionReason: "Coverage confirmed",
    });
    expect(state.balance).toMatchObject({ reserved: 0, used: 1, balance: 9 });
    expect(state.ledger.map(({ kind, amount }) => ({ kind, amount }))).toEqual([
      { kind: "reservation", amount: -1 },
      { kind: "reservation_release", amount: 1 },
      { kind: "usage", amount: -1 },
    ]);
    expect(state.occurrences).toEqual([
      expect.objectContaining({ lifecycleState: "approved" }),
    ]);
  });

  it("rejection and employee withdrawal release reservations exactly once", async () => {
    const fixture = await setupFixture();
    const rejected = await fixture.requester.mutation(
      createLeaveRequestV2,
      requestArgs(fixture, "2026-09-09"),
    );
    await expect(
      fixture.owner.mutation(rejectLeaveRequestV2, {
        leaveRequestId: rejected.leaveRequestId,
        decisionReason: "Peak staffing period",
      }),
    ).resolves.toEqual({ status: "rejected" });

    const withdrawn = await fixture.requester.mutation(
      createLeaveRequestV2,
      requestArgs(fixture, "2026-09-10"),
    );
    await expect(
      fixture.requester.mutation(withdrawPendingLeaveRequest, {
        leaveRequestId: withdrawn.leaveRequestId,
        reason: "Plans changed",
      }),
    ).resolves.toEqual({ status: "cancelled" });

    const state = await fixture.t.run(async (ctx) => ({
      rejected: await ctx.db.get(rejected.leaveRequestId),
      withdrawn: await ctx.db.get(withdrawn.leaveRequestId),
      balance: await ctx.db.get(fixture.balanceId),
      releases: await ctx.db
        .query("leaveLedgerEntries")
        .withIndex("by_employee_effective", (query) =>
          query.eq("employeeId", fixture.employeeId),
        )
        .filter((query) => query.eq(query.field("kind"), "reservation_release"))
        .collect(),
    }));
    expect(state.rejected?.status).toBe("rejected");
    expect(state.withdrawn?.status).toBe("cancelled");
    expect(state.balance).toMatchObject({ reserved: 0, used: 0, balance: 10 });
    expect(state.releases).toHaveLength(2);
  });

  it("requires a second actor for cancellation and routes payroll-locked leave through correction", async () => {
    const fixture = await setupFixture();
    const cancellable = await fixture.requester.mutation(
      createLeaveRequestV2,
      requestArgs(fixture, "2026-09-11"),
    );
    await fixture.owner.mutation(approveLeaveRequestV2, {
      leaveRequestId: cancellable.leaveRequestId,
    });
    await fixture.requester.mutation(requestApprovedLeaveCancellation, {
      leaveRequestId: cancellable.leaveRequestId,
      reason: "Trip cancelled",
    });
    await expect(
      fixture.requester.mutation(approveLeaveCancellation, {
        leaveRequestId: cancellable.leaveRequestId,
        reason: "Self approval",
      }),
    ).rejects.toThrow("cannot approve your own");
    await expect(
      fixture.admin.mutation(approveLeaveCancellation, {
        leaveRequestId: cancellable.leaveRequestId,
        reason: "Cancellation verified",
      }),
    ).resolves.toEqual({ status: "cancelled" });

    const direct = await fixture.requester.mutation(
      createLeaveRequestV2,
      requestArgs(fixture, "2026-09-16"),
    );
    await fixture.owner.mutation(approveLeaveRequestV2, {
      leaveRequestId: direct.leaveRequestId,
    });
    await expect(
      fixture.admin.mutation(approveLeaveCancellation, {
        leaveRequestId: direct.leaveRequestId,
        reason: " ",
      }),
    ).rejects.toThrow("reason is required");
    await fixture.admin.mutation(approveLeaveCancellation, {
      leaveRequestId: direct.leaveRequestId,
      reason: "HR correction of duplicate paper request",
    });

    const locked = await fixture.requester.mutation(
      createLeaveRequestV2,
      requestArgs(fixture, "2026-09-14"),
    );
    await fixture.owner.mutation(approveLeaveRequestV2, {
      leaveRequestId: locked.leaveRequestId,
    });
    await fixture.t.run(async (ctx) => {
      const occurrence = await ctx.db
        .query("leaveRequestOccurrences")
        .withIndex("by_request_local_date", (query) =>
          query.eq("leaveRequestId", locked.leaveRequestId),
        )
        .unique();
      if (!occurrence) throw new Error("Occurrence missing");
      await ctx.db.patch(occurrence._id, { payrollLockedAt: Date.now() });
    });
    await expect(
      fixture.requester.mutation(requestApprovedLeaveCancellation, {
        leaveRequestId: locked.leaveRequestId,
        reason: "Ordinary cancellation",
      }),
    ).rejects.toThrow("payroll-locked");
    await expect(
      fixture.admin.mutation(correctProcessedLeave, {
        leaveRequestId: locked.leaveRequestId,
        reason: "Payroll correction ticket HR-42",
      }),
    ).resolves.toEqual({ status: "corrected" });

    const state = await fixture.t.run(async (ctx) => ({
      cancellable: await ctx.db.get(cancellable.leaveRequestId),
      locked: await ctx.db.get(locked.leaveRequestId),
      direct: await ctx.db.get(direct.leaveRequestId),
      balance: await ctx.db.get(fixture.balanceId),
      restorations: await ctx.db
        .query("leaveLedgerEntries")
        .withIndex("by_employee_effective", (query) =>
          query.eq("employeeId", fixture.employeeId),
        )
        .filter((query) => query.eq(query.field("kind"), "restoration"))
        .collect(),
    }));
    expect(state.cancellable?.status).toBe("cancelled");
    expect(state.locked?.status).toBe("corrected");
    expect(state.direct?.status).toBe("cancelled");
    expect(state.balance).toMatchObject({ reserved: 0, used: 0, balance: 10 });
    expect(state.restorations).toHaveLength(3);
    expect(state.restorations.every((entry) => entry.reversalOfEntryId)).toBe(
      true,
    );
  });

  it("records manual leave and requires auditable balance adjustment inputs", async () => {
    const fixture = await setupFixture();
    await expect(
      fixture.owner.mutation(adjustLeaveBalance, {
        balanceId: fixture.balanceId,
        amount: 1,
        effectiveDate: manilaDate(2026, 8, 15),
        reason: " ",
      }),
    ).rejects.toThrow("reason is required");
    await expect(
      fixture.owner.mutation(adjustLeaveBalance, {
        balanceId: fixture.balanceId,
        amount: 1,
        effectiveDate: manilaDate(2026, 8, 15),
        reason: "Opening balance correction",
      }),
    ).resolves.toMatchObject({
      balanceId: fixture.balanceId,
      available: 11,
    });
    const manual = await fixture.owner.mutation(recordManualLeaveV2, {
      ...requestArgs(fixture, "2026-09-15"),
      decisionReason: "Approved paper form HR-99",
    });
    expect(manual.status).toBe("approved");

    const state = await fixture.t.run(async (ctx) => ({
      request: await ctx.db.get(manual.leaveRequestId),
      balance: await ctx.db.get(fixture.balanceId),
      ledger: await ctx.db
        .query("leaveLedgerEntries")
        .withIndex("by_employee_effective", (query) =>
          query.eq("employeeId", fixture.employeeId),
        )
        .collect(),
    }));
    expect(state.request).toMatchObject({
      isManual: true,
      status: "approved",
      reviewerId: fixture.ownerUserId,
      reviewerSnapshot: { displayName: "Olivia Owner" },
    });
    expect(state.balance).toMatchObject({ used: 1, balance: 10 });
    expect(state.ledger).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "adjustment", amount: 1 }),
        expect.objectContaining({ kind: "usage", amount: -1 }),
      ]),
    );
  });
});
