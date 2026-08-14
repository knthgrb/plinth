import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import type { Id } from "../convex/_generated/dataModel";
import { api } from "../convex/_generated/api";
import schema from "../convex/schema";

const rawModules = import.meta.glob("../convex/**/*.ts");
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => [
    path.replace("../convex/", "./"),
    loader,
  ]),
);

type PublicQualification = {
  qualificationType: string;
  validFrom: number;
  validUntil?: number;
  verificationStatus: "pending" | "verified" | "rejected" | "expired";
};

type RestrictedLeaveDetails =
  | {
      restricted: true;
      detailsVisible: false;
      label: "Restricted leave";
    }
  | {
      restricted: true;
      detailsVisible: true;
      label: string;
      reason: string;
      benefitEvent: {
        eventType: string;
        qualifyingDate: number;
        benefitVariant?: string;
        verificationStatus: "pending" | "verified" | "rejected";
      } | null;
    };

const submitLeaveQualification = makeFunctionReference<
  "mutation",
  {
    organizationId: Id<"organizations">;
    employeeId: Id<"employees">;
    qualificationType: string;
    validFrom: number;
    validUntil?: number;
    documentReferences?: Id<"storageObjects">[];
  },
  { qualificationId: Id<"employeeLeaveQualifications"> } & PublicQualification
>("leaveQualifications:submitLeaveQualification");

const verifyLeaveQualification = makeFunctionReference<
  "mutation",
  {
    qualificationId: Id<"employeeLeaveQualifications">;
    decision: "verified" | "rejected";
  },
  PublicQualification
>("leaveQualifications:verifyLeaveQualification");

const recordLeaveBenefitEvent = makeFunctionReference<
  "mutation",
  {
    organizationId: Id<"organizations">;
    employeeId: Id<"employees">;
    eventType:
      | "maternity"
      | "miscarriage"
      | "emergency_termination_of_pregnancy"
      | "spouse_delivery"
      | "maternity_credit_allocation"
      | "surgery"
      | "adoption"
      | "calamity"
      | "other_protected";
    qualifyingDate: number;
    benefitVariant?: string;
    documentReferences?: Id<"storageObjects">[];
    allocatedFromEventId?: Id<"leaveBenefitEvents">;
    allocatedToEmployeeId?: Id<"employees">;
    allocatedDays?: number;
  },
  Id<"leaveBenefitEvents">
>("leaveQualifications:recordLeaveBenefitEvent");
const verifyLeaveBenefitEvent = makeFunctionReference<
  "mutation",
  {
    benefitEventId: Id<"leaveBenefitEvents">;
    decision: "verified" | "rejected";
  },
  { verificationStatus: "verified" | "rejected" }
>("leaveQualifications:verifyLeaveBenefitEvent");

const grantSensitiveLeaveAccess = makeFunctionReference<
  "mutation",
  {
    organizationId: Id<"organizations">;
    membershipId: Id<"userOrganizations">;
    reason: string;
  },
  Id<"leaveSensitiveAccessGrants">
>("leaveQualifications:grantSensitiveLeaveAccess");

const revokeSensitiveLeaveAccess = makeFunctionReference<
  "mutation",
  {
    organizationId: Id<"organizations">;
    membershipId: Id<"userOrganizations">;
    reason: string;
  },
  { revoked: number }
>("leaveQualifications:revokeSensitiveLeaveAccess");

const getRestrictedLeaveDetails = makeFunctionReference<
  "query",
  {
    leaveRequestId: Id<"leaveRequests">;
    benefitEventId?: Id<"leaveBenefitEvents">;
  },
  RestrictedLeaveDetails
>("leaveQualifications:getRestrictedLeaveDetails");

const workday = { in: "09:00", out: "18:00", isWorkday: true };
const defaultSchedule = {
  monday: workday,
  tuesday: workday,
  wednesday: workday,
  thursday: workday,
  friday: workday,
  saturday: { ...workday, isWorkday: false },
  sunday: { ...workday, isWorkday: false },
};

type FixtureRole = "owner" | "hr" | "manager" | "employee";

async function setupFixture() {
  const t = convexTest(schema, modules);
  const fixture = await t.run(async (ctx) => {
    const organizationId = await ctx.db.insert("organizations", {
      name: "Qualification privacy organization",
      createdAt: 1,
      updatedAt: 1,
    });

    const actors = {} as Record<
      FixtureRole,
      {
        email: string;
        userId: Id<"users">;
        employeeId: Id<"employees">;
        membershipId: Id<"userOrganizations">;
      }
    >;

    for (const role of ["owner", "hr", "manager", "employee"] as const) {
      const email = `${role}-qualification@example.com`;
      const userId = await ctx.db.insert("users", {
        email,
        createdAt: 1,
        updatedAt: 1,
      });
      const employeeId = await ctx.db.insert("employees", {
        organizationId,
        personalInfo: {
          firstName: role,
          lastName: "Qualification",
          email,
        },
        employment: {
          employeeId: `QUAL-${role.toUpperCase()}`,
          position: role,
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
      const membershipId = await ctx.db.insert("userOrganizations", {
        userId,
        organizationId,
        employeeId,
        role,
        accessStatus: "active",
        joinedAt: 1,
        updatedAt: 1,
      });
      actors[role] = { email, userId, employeeId, membershipId };
    }

    const leaveRequestId = await ctx.db.insert("leaveRequests", {
      organizationId,
      employeeId: actors.employee.employeeId,
      leaveType: "custom",
      customLeaveType: "VAWC Leave",
      startDate: 1_786_723_200_000,
      endDate: 1_786_723_200_000,
      numberOfDays: 1,
      reason: "Protected case details",
      status: "pending",
      filedDate: 1_786_636_800_000,
      createdAt: 1,
      updatedAt: 1,
    });

    return { organizationId, actors, leaveRequestId };
  });

  return {
    t,
    ...fixture,
    actor(role: FixtureRole) {
      return t.withIdentity({ email: fixture.actors[role].email });
    },
  };
}

describe("leave qualifications", () => {
  it("lets an employee submit only their own effective-dated qualification and hides evidence from the response", async () => {
    const { actor, organizationId, actors, t } = await setupFixture();
    const employee = actors.employee;
    const storageObjectId = await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob(["evidence"]));
      return await ctx.db.insert("storageObjects", {
        storageId,
        organizationId,
        ownerUserId: employee.userId,
        purpose: "leave_attachment",
        state: "active",
        createdAt: 1,
        updatedAt: 1,
      });
    });

    const result = await actor("employee").mutation(
      submitLeaveQualification,
      {
        organizationId,
        employeeId: employee.employeeId,
        qualificationType: "solo_parent",
        validFrom: 1_767_225_600_000,
        validUntil: 1_798_761_600_000,
        documentReferences: [storageObjectId],
      },
    );

    expect(result).toEqual({
      qualificationId: expect.any(String),
      qualificationType: "solo_parent",
      validFrom: 1_767_225_600_000,
      validUntil: 1_798_761_600_000,
      verificationStatus: "pending",
    });
    expect(result).not.toHaveProperty("documentReferences");

    const stored = await t.run((ctx) => ctx.db.get(result.qualificationId));
    expect(stored?.documentReferences).toEqual([storageObjectId]);

    await expect(
      actor("employee").mutation(submitLeaveQualification, {
        organizationId,
        employeeId: actors.manager.employeeId,
        qualificationType: "solo_parent",
        validFrom: 1_767_225_600_000,
      }),
    ).rejects.toThrow("Not authorized");
  });

  it("allows HR to verify a qualification and rejects manager verification", async () => {
    const { actor, organizationId, actors } = await setupFixture();
    const submitted = await actor("employee").mutation(
      submitLeaveQualification,
      {
        organizationId,
        employeeId: actors.employee.employeeId,
        qualificationType: "solo_parent",
        validFrom: 1_767_225_600_000,
        validUntil: 1_798_761_600_000,
      },
    );

    await expect(
      actor("manager").mutation(verifyLeaveQualification, {
        qualificationId: submitted.qualificationId,
        decision: "verified",
      }),
    ).rejects.toThrow("Owner, Admin, or HR approval is required");

    await expect(
      actor("hr").mutation(verifyLeaveQualification, {
        qualificationId: submitted.qualificationId,
        decision: "verified",
      }),
    ).resolves.toEqual({
      qualificationType: "solo_parent",
      validFrom: 1_767_225_600_000,
      validUntil: 1_798_761_600_000,
      verificationStatus: "verified",
    });
  });

  it("rejects maternity-credit allocations above seven days", async () => {
    const { actor, organizationId, actors } = await setupFixture();
    const employee = actors.employee;
    const maternityEventId = await actor("employee").mutation(
      recordLeaveBenefitEvent,
      {
        organizationId,
        employeeId: employee.employeeId,
        eventType: "maternity",
        qualifyingDate: 1_786_723_200_000,
        benefitVariant: "live_birth",
      },
    );
    await expect(
      actor("hr").mutation(verifyLeaveBenefitEvent, {
        benefitEventId: maternityEventId,
        decision: "verified",
      }),
    ).resolves.toEqual({ verificationStatus: "verified" });

    await expect(
      actor("employee").mutation(recordLeaveBenefitEvent, {
        organizationId,
        employeeId: employee.employeeId,
        eventType: "maternity_credit_allocation",
        qualifyingDate: 1_786_723_200_000,
        allocatedFromEventId: maternityEventId,
        allocatedToEmployeeId: actors.owner.employeeId,
        allocatedDays: 8,
      }),
    ).rejects.toThrow("Maternity credit allocation cannot exceed 7 days");

    await expect(
      actor("employee").mutation(recordLeaveBenefitEvent, {
        organizationId,
        employeeId: employee.employeeId,
        eventType: "maternity_credit_allocation",
        qualifyingDate: 1_786_723_200_000,
        allocatedFromEventId: maternityEventId,
        allocatedToEmployeeId: actors.owner.employeeId,
        allocatedDays: 7,
      }),
    ).resolves.toEqual(expect.any(String));
  });
});

describe("restricted leave privacy", () => {
  it("returns a neutral VAWC label until an Owner grants access and preserves grant revocation history", async () => {
    const { actor, organizationId, actors, leaveRequestId, t } =
      await setupFixture();
    const benefitEventId = await actor("employee").mutation(
      recordLeaveBenefitEvent,
      {
        organizationId,
        employeeId: actors.employee.employeeId,
        eventType: "other_protected",
        qualifyingDate: 1_786_723_200_000,
        benefitVariant: "vawc_protection_order",
      },
    );

    await expect(
      actor("hr").query(getRestrictedLeaveDetails, {
        leaveRequestId,
        benefitEventId,
      }),
    ).resolves.toEqual({
      restricted: true,
      detailsVisible: false,
      label: "Restricted leave",
    });

    const grantId = await actor("owner").mutation(
      grantSensitiveLeaveAccess,
      {
        organizationId,
        membershipId: actors.hr.membershipId,
        reason: "Handle protected leave cases",
      },
    );

    await expect(
      actor("hr").query(getRestrictedLeaveDetails, {
        leaveRequestId,
        benefitEventId,
      }),
    ).resolves.toEqual({
      restricted: true,
      detailsVisible: true,
      label: "VAWC Leave",
      reason: "Protected case details",
      benefitEvent: {
        eventType: "other_protected",
        qualifyingDate: 1_786_723_200_000,
        benefitVariant: "vawc_protection_order",
        verificationStatus: "pending",
      },
    });

    await expect(
      actor("hr").mutation(revokeSensitiveLeaveAccess, {
        organizationId,
        membershipId: actors.hr.membershipId,
        reason: "No longer assigned",
      }),
    ).rejects.toThrow("Owner access is required");
    await expect(
      actor("owner").mutation(revokeSensitiveLeaveAccess, {
        organizationId,
        membershipId: actors.hr.membershipId,
        reason: "No longer assigned",
      }),
    ).resolves.toEqual({ revoked: 1 });
    const administrativeEvents = await t.run((ctx) =>
      ctx.db
        .query("leaveAdministrativeEvents")
        .withIndex("by_membership_created", (q) =>
          q.eq("membershipId", actors.hr.membershipId),
        )
        .collect(),
    );
    expect(administrativeEvents.map((event) => event.type)).toEqual([
      "sensitive_access_granted",
      "sensitive_access_revoked",
    ]);

    const grant = await t.run((ctx) => ctx.db.get(grantId));
    expect(grant).toMatchObject({
      isActive: false,
      revokedBy: actors.owner.userId,
    });
    await expect(
      actor("hr").query(getRestrictedLeaveDetails, {
        leaveRequestId,
        benefitEventId,
      }),
    ).resolves.toEqual({
      restricted: true,
      detailsVisible: false,
      label: "Restricted leave",
    });
  });

  it("issues a leave attachment URL only for a file linked to that request", async () => {
    const { actor, organizationId, actors, leaveRequestId, t } =
      await setupFixture();
    const { linkedStorageId, unrelatedStorageId } = await t.run(
      async (ctx) => {
        const linkedStorageId = await ctx.storage.store(
          new Blob(["linked leave evidence"]),
        );
        const unrelatedStorageId = await ctx.storage.store(
          new Blob(["unrelated leave evidence"]),
        );
        const unrelatedRequestId = await ctx.db.insert("leaveRequests", {
          organizationId,
          employeeId: actors.employee.employeeId,
          leaveType: "sick",
          startDate: 1_786_809_600_000,
          endDate: 1_786_809_600_000,
          numberOfDays: 1,
          reason: "Ordinary request",
          status: "pending",
          filedDate: 1_786_636_800_000,
          createdAt: 1,
          updatedAt: 1,
        });
        for (const [parentId, storageId] of [
          [leaveRequestId, linkedStorageId],
          [unrelatedRequestId, unrelatedStorageId],
        ] as const) {
          await ctx.db.insert("storageObjectLinks", {
            organizationId,
            storageId,
            parentType: "leave_request",
            parentId,
            purpose: "leave_attachment",
            sourceIndex: 0,
            migrationVersion: 1,
            createdAt: 1,
            updatedAt: 1,
          });
        }
        return { linkedStorageId, unrelatedStorageId };
      },
    );
    await actor("owner").mutation(grantSensitiveLeaveAccess, {
      organizationId,
      membershipId: actors.hr.membershipId,
      reason: "Review protected attachment",
    });

    await expect(
      actor("hr").query(api.files.getLeaveAttachmentUrl, {
        leaveRequestId,
        storageId: linkedStorageId,
      }),
    ).resolves.toMatch(/^https:\/\//);
    await expect(
      actor("hr").query(api.files.getLeaveAttachmentUrl, {
        leaveRequestId,
        storageId: unrelatedStorageId,
      }),
    ).rejects.toThrow("Not authorized");
    await expect(
      actor("hr").query(api.files.getFileUrl, {
        organizationId,
        storageId: linkedStorageId,
      }),
    ).rejects.toThrow("leave attachment access endpoint");
  });
});
