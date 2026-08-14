import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api";
import schema from "../convex/schema";

vi.mock("../convex/auth", () => ({
  authComponent: {
    getAuthUser: async (ctx: {
      auth: { getUserIdentity: () => Promise<{ email?: string } | null> };
    }) => ctx.auth.getUserIdentity(),
  },
}));

const rawModules = import.meta.glob("../convex/**/*.ts");
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => [
    path.replace("../convex/", "./"),
    loader,
  ]),
);

afterEach(() => {
  vi.useRealTimers();
});

async function setup() {
  const t = convexTest(schema, modules);
  const identities = {
    hr: "workflow-hr@example.com",
    owner: "workflow-owner@example.com",
  };
  const fixture = await t.run(async (ctx) => {
    const organizationId = await ctx.db.insert("organizations", {
      name: "Workflow Integrity",
      createdAt: 1,
      updatedAt: 1,
    });
    const otherOrganizationId = await ctx.db.insert("organizations", {
      name: "Other Organization",
      createdAt: 1,
      updatedAt: 1,
    });
    const hrUserId = await ctx.db.insert("users", {
      email: identities.hr,
      createdAt: 1,
      updatedAt: 1,
    });
    const ownerUserId = await ctx.db.insert("users", {
      email: identities.owner,
      createdAt: 1,
      updatedAt: 1,
    });
    for (const [userId, role] of [
      [hrUserId, "hr"],
      [ownerUserId, "owner"],
    ] as const) {
      await ctx.db.insert("userOrganizations", {
        userId,
        organizationId,
        role,
        accessStatus: "active",
        joinedAt: 1,
        updatedAt: 1,
      });
    }
    const employeeId = await ctx.db.insert("employees", {
      organizationId,
      personalInfo: {
        firstName: "Rina",
        lastName: "Santos",
        email: "rina@example.com",
      },
      employment: {
        employeeId: "EMP-1",
        position: "Analyst",
        department: "Operations",
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
    const resume = await ctx.storage.store(
      new Blob(["resume"], { type: "application/pdf" }),
    );
    const jobId = await ctx.db.insert("jobs", {
      organizationId,
      title: "Senior Analyst",
      department: "Operations",
      position: "Senior Analyst",
      employmentType: "regular",
      numberOfOpenings: 1,
      description: "Own reporting workflows",
      requirements: [],
      qualifications: [],
      status: "open",
      postedDate: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    const applicantId = await ctx.db.insert("applicants", {
      organizationId,
      jobId,
      firstName: "Ana",
      lastName: "Reyes",
      email: "ana@example.com",
      phone: "",
      resume,
      status: "assessment",
      appliedDate: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("applicantStageEvents", {
      organizationId,
      applicantId,
      sourceIndex: 0,
      to: "assessment",
      changedAt: 1,
      changedBy: hrUserId,
      migrationVersion: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("applicantScorecards", {
      organizationId,
      applicantId,
      sourceIndex: 0,
      reviewer: hrUserId,
      criteria: [{ label: "Role expertise", score: 4 }],
      overallScore: 4,
      submittedAt: 1,
      migrationVersion: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    return {
      organizationId,
      otherOrganizationId,
      hrUserId,
      ownerUserId,
      employeeId,
      applicantId,
      jobId,
    };
  });
  return {
    t,
    hr: t.withIdentity({ email: identities.hr }),
    owner: t.withIdentity({ email: identities.owner }),
    ...fixture,
  };
}

describe("requirements integrity", () => {
  it("preserves stable verified evidence when a policy is removed", async () => {
    vi.useFakeTimers();
    const { t, hr, organizationId, hrUserId, employeeId } = await setup();
    await hr.mutation(api.organizations.updateDefaultRequirements, {
      organizationId,
      requirements: [{ type: "Government ID", isRequired: true }],
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const requirement = await t.run(async (ctx) =>
      ctx.db
        .query("employeeRequirements")
        .withIndex("by_organization", (query) =>
          query.eq("organizationId", organizationId),
        )
        .filter((query) => query.eq(query.field("employeeId"), employeeId))
        .unique(),
    );
    expect(requirement).not.toBeNull();
    const evidence = await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(
        new Blob(["evidence"], { type: "application/pdf" }),
      );
      await ctx.db.insert("storageObjects", {
        storageId,
        organizationId,
        ownerUserId: hrUserId,
        purpose: "employee_requirement",
        state: "active",
        createdAt: 2,
        updatedAt: 2,
      });
      return storageId;
    });
    await hr.mutation(api.employees.updateRequirementFile, {
      employeeId,
      requirementId: requirement!._id,
      file: evidence,
    });
    await hr.mutation(api.employees.updateRequirementStatus, {
      employeeId,
      requirementId: requirement!._id,
      status: "verified",
      verificationNotes: "Identity checked",
    });

    await hr.mutation(api.organizations.updateDefaultRequirements, {
      organizationId,
      requirements: [],
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const retained = await t.run((ctx) => ctx.db.get(requirement!._id));
    expect(retained).toMatchObject({
      file: evidence,
      status: "verified",
      verificationNotes: "Identity checked",
    });
  });

  it("rejects requirement identifiers and evidence from another tenant", async () => {
    const { t, hr, organizationId, otherOrganizationId, hrUserId, employeeId } =
      await setup();
    const requirementId = await t.run((ctx) =>
      ctx.db.insert("employeeRequirements", {
        organizationId,
        employeeId,
        sourceKey: "government-id:0",
        type: "Government ID",
        status: "pending",
        isRequired: true,
        migrationVersion: 1,
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    const { foreignEvidence, otherRequirementId } = await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob(["foreign"]));
      await ctx.db.insert("storageObjects", {
        storageId,
        organizationId: otherOrganizationId,
        ownerUserId: hrUserId,
        purpose: "employee_requirement",
        state: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      const employee = await ctx.db.get(employeeId);
      if (!employee) throw new Error("Missing employee fixture");
      const { _id, _creationTime, ...employeeValue } = employee;
      void _id;
      void _creationTime;
      const otherEmployeeId = await ctx.db.insert("employees", {
        ...employeeValue,
        personalInfo: {
          ...employee.personalInfo,
          email: "other-employee@example.com",
        },
        employment: { ...employee.employment, employeeId: "EMP-2" },
      });
      const otherRequirementId = await ctx.db.insert("employeeRequirements", {
        organizationId,
        employeeId: otherEmployeeId,
        sourceKey: "government-id:0",
        type: "Government ID",
        status: "pending",
        isRequired: true,
        migrationVersion: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      return { foreignEvidence: storageId, otherRequirementId };
    });

    await expect(
      hr.mutation(api.employees.updateRequirementStatus, {
        employeeId,
        requirementId: otherRequirementId,
        status: "verified",
      }),
    ).rejects.toThrow("Requirement not found");

    await expect(
      hr.mutation(api.employees.updateRequirementFile, {
        employeeId,
        requirementId,
        file: foreignEvidence,
      }),
    ).rejects.toThrow("Not authorized");
  });
});

describe("recruitment integrity", () => {
  it("normalizes edit-time email and rejects per-job duplicates", async () => {
    const { t, hr, organizationId, applicantId, jobId } = await setup();
    const duplicateId = await t.run(async (ctx) => {
      const resume = await ctx.storage.store(new Blob(["resume"]));
      return ctx.db.insert("applicants", {
        organizationId,
        jobId,
        firstName: "Ben",
        lastName: "Cruz",
        email: "duplicate@example.com",
        phone: "",
        resume,
        status: "new",
        appliedDate: 1,
        createdAt: 1,
        updatedAt: 1,
      });
    });

    await expect(
      hr.mutation(api.recruitment.updateApplicant, {
        applicantId,
        email: " DUPLICATE@EXAMPLE.COM ",
      }),
    ).rejects.toThrow("already exists");
    await hr.mutation(api.recruitment.updateApplicant, {
      applicantId: duplicateId,
      email: " Unique@Example.com ",
    });
    expect((await t.run((ctx) => ctx.db.get(duplicateId)))?.email).toBe(
      "unique@example.com",
    );
  });

  it("rejects scorecards outside interview and assessment", async () => {
    const { t, hr, applicantId } = await setup();
    await t.run((ctx) => ctx.db.patch(applicantId, { status: "new" }));
    await expect(
      hr.mutation(api.recruitment.addApplicantScorecard, {
        applicantId,
        criteria: [{ label: "Role expertise", score: 4 }],
      }),
    ).rejects.toThrow("interview or assessment");
  });

  it("preserves immutable offer cycles and revokes approval on rejection", async () => {
    const { hr, owner, applicantId } = await setup();
    await hr.mutation(api.recruitment.requestOfferApproval, { applicantId });
    await owner.mutation(api.recruitment.approveOffer, {
      applicantId,
      approved: true,
    });
    await hr.mutation(api.recruitment.updateApplicantStatus, {
      applicantId,
      status: "rejected",
      rejectionReason: "Role scope changed",
    });
    let applicant = await hr.query(api.recruitment.getApplicant, {
      applicantId,
    });
    expect(applicant?.offerApproval?.status).toBe("rejected");
    expect(applicant?.offerHistory.map((event) => event.status)).toEqual([
      "pending",
      "approved",
      "rejected",
    ]);

    await hr.mutation(api.recruitment.updateApplicantStatus, {
      applicantId,
      status: "screening",
    });
    await hr.mutation(api.recruitment.updateApplicantStatus, {
      applicantId,
      status: "interview",
    });
    await hr.mutation(api.recruitment.requestOfferApproval, { applicantId });
    applicant = await hr.query(api.recruitment.getApplicant, { applicantId });
    expect(applicant?.offerHistory.map((event) => event.cycle)).toEqual([
      1, 1, 1, 2,
    ]);
    expect(applicant?.offerApproval?.status).toBe("pending");
  });

  it("enforces separation of duties for offer approval", async () => {
    const { owner, applicantId } = await setup();
    await owner.mutation(api.recruitment.requestOfferApproval, { applicantId });
    await expect(
      owner.mutation(api.recruitment.approveOffer, {
        applicantId,
        approved: true,
      }),
    ).rejects.toThrow("another owner or admin");
  });

  it("archives applicants without deleting their audit records", async () => {
    const { t, hr, organizationId, applicantId } = await setup();
    await hr.mutation(api.recruitment.deleteApplicant, { applicantId });
    const state = await t.run(async (ctx) => ({
      applicant: await ctx.db.get(applicantId),
      stages: await ctx.db
        .query("applicantStageEvents")
        .withIndex("by_applicant_source_index", (query) =>
          query.eq("applicantId", applicantId),
        )
        .collect(),
    }));
    expect(state.applicant?.archivedAt).toBeTypeOf("number");
    expect(state.stages).not.toHaveLength(0);

    const visible = await hr.query(api.recruitment.getApplicants, {
      organizationId,
      paginationOpts: { cursor: null, numItems: 20 },
    });
    expect(visible.page.map((applicant) => applicant._id)).not.toContain(
      applicantId,
    );
  });

  it("rejects future conversion dates and creates lifecycle invariants", async () => {
    const { t, hr, owner, applicantId } = await setup();
    await hr.mutation(api.recruitment.requestOfferApproval, { applicantId });
    await owner.mutation(api.recruitment.approveOffer, {
      applicantId,
      approved: true,
    });
    const employeeData = {
      employeeId: "REC-001",
      position: "Senior Analyst",
      department: "Operations",
      employmentType: "regular" as const,
      hireDate: Date.now() + 86_400_000,
      basicSalary: 45_000,
      salaryType: "monthly" as const,
    };
    await expect(
      hr.mutation(api.recruitment.convertApplicantToEmployee, {
        applicantId,
        employeeData,
      }),
    ).rejects.toThrow("Hire date cannot be in the future");

    const employeeId = await hr.mutation(
      api.recruitment.convertApplicantToEmployee,
      {
        applicantId,
        employeeData: { ...employeeData, hireDate: Date.now() - 86_400_000 },
      },
    );
    const state = await t.run(async (ctx) => ({
      lifecycle: await ctx.db
        .query("employeeLifecycleEvents")
        .withIndex("by_employee_effective_at", (query) =>
          query.eq("employeeId", employeeId),
        )
        .collect(),
      schedules: await ctx.db
        .query("employeeScheduleHistory")
        .withIndex("by_employee", (query) => query.eq("employeeId", employeeId))
        .collect(),
    }));
    expect(state.lifecycle).toHaveLength(1);
    expect(state.lifecycle[0]?.type).toBe("hired");
    expect(state.schedules).toHaveLength(1);
  });
});
