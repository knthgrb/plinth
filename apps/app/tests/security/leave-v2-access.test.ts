import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, it } from "vitest";
import {
  canAdministerLeave,
  canReviewLeave,
  canViewSensitiveLeave,
  requireFinalLeaveReviewer,
  requireLeaveSelfService,
  requireSensitiveLeaveAccess,
} from "../../convex/leaveAccess";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";

const rawModules = import.meta.glob("../../convex/**/*.ts");
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => [
    path.replace("../../convex/", "./"),
    loader,
  ]),
);

const getLeaveRequest = makeFunctionReference<
  "query",
  { leaveRequestId: Id<"leaveRequests"> },
  unknown
>("leave:getLeaveRequest");
const getLeaveRequestApprovalInfo = makeFunctionReference<
  "query",
  { leaveRequestId: Id<"leaveRequests"> },
  { canApprove: boolean; blockReason?: string }
>("leave:getLeaveRequestApprovalInfo");

const workday = { in: "09:00", out: "18:00", isWorkday: true };
const restDay = { in: "09:00", out: "18:00", isWorkday: false };
const defaultSchedule = {
  monday: workday,
  tuesday: workday,
  wednesday: workday,
  thursday: workday,
  friday: workday,
  saturday: restDay,
  sunday: restDay,
};

type MembershipRole =
  | "owner"
  | "admin"
  | "hr"
  | "manager"
  | "employee"
  | "accounting";
type AccessStatus =
  | "active"
  | "suspended"
  | "alumni"
  | "disabled"
  | "removed";

async function setupAccessFixture(options: {
  role?: MembershipRole;
  accessStatus?: AccessStatus;
  requestOwnLeave?: boolean;
}) {
  const t = convexTest(schema, modules);
  const actorEmail = "leave-access-actor@example.com";
  const fixture = await t.run(async (ctx) => {
    const organizationId = await ctx.db.insert("organizations", {
      name: "Leave Access Org",
      createdAt: 1,
      updatedAt: 1,
    });
    const actorUserId = await ctx.db.insert("users", {
      email: actorEmail,
      createdAt: 1,
      updatedAt: 1,
    });
    const actorEmployeeId = await ctx.db.insert("employees", {
      organizationId,
      personalInfo: {
        firstName: "Access",
        lastName: "Actor",
        email: actorEmail,
      },
      employment: {
        employeeId: "LEAVE-ACCESS-ACTOR",
        position: "Reviewer",
        department: "People",
        employmentType: "regular",
        hireDate: 1,
        status: "active",
      },
      compensation: { basicSalary: 30_000, salaryType: "monthly" },
      schedule: { defaultSchedule },
      createdAt: 1,
      updatedAt: 1,
    });
    const targetEmployeeId = await ctx.db.insert("employees", {
      organizationId,
      personalInfo: {
        firstName: "Leave",
        lastName: "Requester",
        email: "leave-requester@example.com",
      },
      employment: {
        employeeId: "LEAVE-ACCESS-TARGET",
        position: "Analyst",
        department: "Operations",
        employmentType: "regular",
        hireDate: 1,
        status: "active",
      },
      compensation: { basicSalary: 30_000, salaryType: "monthly" },
      schedule: { defaultSchedule },
      createdAt: 1,
      updatedAt: 1,
    });
    const membershipId = await ctx.db.insert("userOrganizations", {
      userId: actorUserId,
      organizationId,
      employeeId: actorEmployeeId,
      role: options.role ?? "employee",
      accessStatus: options.accessStatus ?? "active",
      joinedAt: 1,
      updatedAt: 1,
    });
    const requestEmployeeId = options.requestOwnLeave
      ? actorEmployeeId
      : targetEmployeeId;
    const leaveRequestId = await ctx.db.insert("leaveRequests", {
      organizationId,
      employeeId: requestEmployeeId,
      leaveType: "vacation",
      startDate: 1,
      endDate: 1,
      numberOfDays: 1,
      reason: "Planned leave",
      status: "pending",
      filedDate: 1,
      createdAt: 1,
      updatedAt: 1,
    });

    return {
      actorUserId,
      actorEmployeeId,
      targetEmployeeId,
      organizationId,
      membershipId,
      leaveRequestId,
    };
  });

  return { t, actor: t.withIdentity({ email: actorEmail }), ...fixture };
}

describe("leave V2 authorization decisions", () => {
  it.each([
    ["manager", "e1", "e2"],
    ["employee", "e1", "e2"],
    ["accounting", "e1", "e2"],
  ] as const)(
    "rejects %s from directly reviewing another employee's request",
    (role, reviewerEmployeeId, requestEmployeeId) => {
      expect(
        canReviewLeave({ role, reviewerEmployeeId, requestEmployeeId }),
      ).toEqual({
        allowed: false,
        reason: "Owner, Admin, or HR approval is required",
      });
    },
  );

  it.each(["owner", "admin", "hr"] as const)(
    "rejects %s from approving their own linked leave request",
    (role) => {
      expect(
        canReviewLeave({
          role,
          reviewerEmployeeId: "e1",
          requestEmployeeId: "e1",
        }),
      ).toEqual({
        allowed: false,
        reason: "You cannot approve your own leave request",
      });
    },
  );

  it.each(["owner", "admin", "hr"] as const)(
    "allows %s to review another employee's request",
    (role) => {
      expect(
        canReviewLeave({
          role,
          reviewerEmployeeId: "e1",
          requestEmployeeId: "e2",
        }),
      ).toEqual({ allowed: true });
    },
  );

  it("allows the requesting employee to view restricted details without a grant", () => {
    expect(
      canViewSensitiveLeave({
        isRequestEmployee: true,
        hasActiveGrant: false,
      }),
    ).toBe(true);
  });

  it("denies restricted details to another employee without an active grant", () => {
    expect(
      canViewSensitiveLeave({
        isRequestEmployee: false,
        hasActiveGrant: false,
      }),
    ).toBe(false);
  });

  it("allows restricted details to another employee with an active grant", () => {
    expect(
      canViewSensitiveLeave({
        isRequestEmployee: false,
        hasActiveGrant: true,
      }),
    ).toBe(true);
  });
});

describe("leave V2 authenticated access", () => {
  it("reserves organization-wide leave administration for Owner, Admin, and HR", () => {
    expect(canAdministerLeave("owner")).toBe(true);
    expect(canAdministerLeave("admin")).toBe(true);
    expect(canAdministerLeave("hr")).toBe(true);
    expect(canAdministerLeave("manager")).toBe(false);
    expect(canAdministerLeave("accounting")).toBe(false);
    expect(canAdministerLeave("employee")).toBe(false);
  });

  it("requires an active membership for employee self-service", async () => {
    const { actor, organizationId, actorEmployeeId } =
      await setupAccessFixture({ accessStatus: "suspended" });

    await expect(
      actor.query((ctx) =>
        requireLeaveSelfService(ctx, organizationId, actorEmployeeId),
      ),
    ).rejects.toThrow("Not authorized");
  });

  it("rejects self-service access to another employee record", async () => {
    const { actor, organizationId, targetEmployeeId } =
      await setupAccessFixture({});

    await expect(
      actor.query((ctx) =>
        requireLeaveSelfService(ctx, organizationId, targetEmployeeId),
      ),
    ).rejects.toThrow("Not authorized");
  });

  it("rejects a manager from final review", async () => {
    const { actor, leaveRequestId } = await setupAccessFixture({
      role: "manager",
    });

    await expect(
      actor.query((ctx) => requireFinalLeaveReviewer(ctx, leaveRequestId)),
    ).rejects.toThrow("Owner, Admin, or HR approval is required");
  });

  it.each(["manager", "accounting"] as const)(
    "does not let %s directly read another employee's legacy request",
    async (role) => {
      const { actor, leaveRequestId } = await setupAccessFixture({ role });

      await expect(
        actor.query(getLeaveRequest, { leaveRequestId }),
      ).rejects.toThrow("Not authorized");
      await expect(
        actor.query(getLeaveRequestApprovalInfo, { leaveRequestId }),
      ).resolves.toEqual({ canApprove: false, blockReason: "Not authorized" });
    },
  );

  it("rejects an HR member from reviewing their own linked request", async () => {
    const { actor, leaveRequestId } = await setupAccessFixture({
      role: "hr",
      requestOwnLeave: true,
    });

    await expect(
      actor.query((ctx) => requireFinalLeaveReviewer(ctx, leaveRequestId)),
    ).rejects.toThrow("You cannot approve your own leave request");
  });

  it("denies restricted leave details without an active grant", async () => {
    const { actor, organizationId, targetEmployeeId } =
      await setupAccessFixture({ role: "hr" });

    await expect(
      actor.query((ctx) =>
        requireSensitiveLeaveAccess(ctx, organizationId, targetEmployeeId),
      ),
    ).rejects.toThrow("Not authorized");
  });

  it("allows restricted leave details through an active indexed grant", async () => {
    const {
      t,
      actor,
      actorUserId,
      organizationId,
      membershipId,
      targetEmployeeId,
    } = await setupAccessFixture({ role: "hr" });
    await t.run(async (ctx) => {
      await ctx.db.insert("leaveSensitiveAccessGrants", {
        organizationId,
        membershipId,
        isActive: true,
        grantedBy: actorUserId,
        grantedAt: 1,
      });
    });

    const access = await actor.query((ctx) =>
      requireSensitiveLeaveAccess(ctx, organizationId, targetEmployeeId),
    );
    expect(access.membership._id).toBe(membershipId);
  });
});
