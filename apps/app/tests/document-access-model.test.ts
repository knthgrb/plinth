import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";

import { api } from "../convex/_generated/api";
import type { Doc, Id } from "../convex/_generated/dataModel";
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

const workday = { in: "09:00", out: "18:00", isWorkday: true };
const restDay = { in: "09:00", out: "18:00", isWorkday: false };
const schedule: Doc<"employees">["schedule"] = {
  defaultSchedule: {
    monday: workday,
    tuesday: workday,
    wednesday: workday,
    thursday: workday,
    friday: workday,
    saturday: restDay,
    sunday: restDay,
  },
};

async function setupDocumentAccessFixture() {
  const t = convexTest(schema, modules);
  const fixture = await t.run(async (ctx) => {
    const organizationId = await ctx.db.insert("organizations", {
      name: "Document Access Org",
      createdAt: 1,
      updatedAt: 1,
    });
    const makeIdentity = async (args: {
      email: string;
      role: Doc<"userOrganizations">["role"];
      accessStatus: Doc<"userOrganizations">["accessStatus"];
      department: string;
      employeeStatus: Doc<"employees">["employment"]["status"];
    }) => {
      const userId = await ctx.db.insert("users", {
        email: args.email,
        createdAt: 1,
        updatedAt: 1,
      });
      const employeeId = await ctx.db.insert("employees", {
        organizationId,
        personalInfo: {
          firstName: args.email.split("@")[0],
          lastName: "User",
          email: args.email,
        },
        employment: {
          employeeId: args.email,
          position: "Specialist",
          department: args.department,
          employmentType: "regular",
          hireDate: 1,
          status: args.employeeStatus,
        },
        compensation: { basicSalary: 30_000, salaryType: "monthly" },
        schedule,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("userOrganizations", {
        userId,
        organizationId,
        employeeId,
        role: args.role,
        accessStatus: args.accessStatus,
        joinedAt: 1,
        updatedAt: 1,
      });
      return { userId, employeeId, email: args.email };
    };
    const owner = await makeIdentity({
      email: "owner@example.com",
      role: "owner",
      accessStatus: "active",
      department: "Operations",
      employeeStatus: "active",
    });
    const hr = await makeIdentity({
      email: "hr@example.com",
      role: "hr",
      accessStatus: "active",
      department: "People",
      employeeStatus: "active",
    });
    const employee = await makeIdentity({
      email: "employee@example.com",
      role: "employee",
      accessStatus: "active",
      department: "Operations",
      employeeStatus: "active",
    });
    const otherEmployee = await makeIdentity({
      email: "other@example.com",
      role: "employee",
      accessStatus: "active",
      department: "Finance",
      employeeStatus: "active",
    });
    const alumnus = await makeIdentity({
      email: "alumnus@example.com",
      role: "employee",
      accessStatus: "alumni",
      department: "Operations",
      employeeStatus: "resigned",
    });

    const insertDocument = async (args: {
      title: string;
      visibilityScope: NonNullable<Doc<"documents">["visibilityScope"]>;
      employeeId?: Id<"employees">;
      visibleDepartment?: string;
    }) => {
      const documentId = await ctx.db.insert("documents", {
        organizationId,
        employeeId: args.employeeId,
        createdBy: owner.userId,
        title: args.title,
        content: "{}",
        type: "other",
        visibilityScope: args.visibilityScope,
        createdAt: 1,
        updatedAt: 1,
      });
      if (args.visibleDepartment) {
        await ctx.db.insert("documentAccessGrants", {
          organizationId,
          documentId,
          grantType: "department",
          department: args.visibleDepartment,
          sourceField: "visibleDepartments",
          sourceIndex: 0,
          migrationVersion: 1,
          createdAt: 1,
          updatedAt: 1,
        });
      }
      return documentId;
    };

    await insertDocument({
      title: "Management handbook",
      visibilityScope: "admins_only",
    });
    await insertDocument({
      title: "Company handbook",
      visibilityScope: "all_employees",
    });
    await insertDocument({
      title: "Operations guide",
      visibilityScope: "department",
      visibleDepartment: "Operations",
    });
    await insertDocument({
      title: "Owner private record",
      visibilityScope: "admins_only",
      employeeId: owner.employeeId,
    });
    await insertDocument({
      title: "Owner visible record",
      visibilityScope: "specific_employee",
      employeeId: owner.employeeId,
    });
    await insertDocument({
      title: "Employee visible record",
      visibilityScope: "specific_employee",
      employeeId: employee.employeeId,
    });
    await insertDocument({
      title: "Payroll working file",
      visibilityScope: "payroll_visible",
    });
    await insertDocument({
      title: "Alumnus certificate",
      visibilityScope: "alumni_visible",
      employeeId: alumnus.employeeId,
    });
    await insertDocument({
      title: "Other employee alumni record",
      visibilityScope: "alumni_visible",
      employeeId: otherEmployee.employeeId,
    });

    return { organizationId, owner, hr, employee, alumnus };
  });
  return { t, ...fixture };
}

describe("document access model", () => {
  it("limits an elevated member in employee view to their own visible employee file", async () => {
    const { t, organizationId, owner } = await setupDocumentAccessFixture();
    const documents = await t.withIdentity({ email: owner.email }).query(
      api.documents.getDocuments,
      { organizationId, employeeExperienceMode: true },
    );

    expect(documents.map((document) => document.title)).toEqual([
      "Owner visible record",
    ]);
  });

  it("prevents a regular employee from creating organization documents", async () => {
    const { t, organizationId, employee } = await setupDocumentAccessFixture();

    await expect(
      t.withIdentity({ email: employee.email }).mutation(
        api.documents.createDocument,
        {
          organizationId,
          title: "Employee-created policy",
          content: "{}",
          type: "other",
          visibilityScope: "all_employees",
        },
      ),
    ).rejects.toThrow("Not authorized");
  });

  it("stores new organization documents as management-only", async () => {
    const { t, organizationId, owner } = await setupDocumentAccessFixture();
    const documentId = await t
      .withIdentity({ email: owner.email })
      .mutation(api.documents.createDocument, {
        organizationId,
        title: "Attempted shared policy",
        content: "{}",
        type: "other",
        visibilityScope: "all_employees",
      });
    const document = await t.run(async (ctx) => ctx.db.get(documentId));

    expect(document?.employeeId).toBeUndefined();
    expect(document?.visibilityScope).toBe("admins_only");
  });

  it("limits alumni to their own explicitly retained employee-file documents", async () => {
    const { t, organizationId, alumnus } = await setupDocumentAccessFixture();
    const documents = await t.withIdentity({ email: alumnus.email }).query(
      api.documents.getDocuments,
      { organizationId },
    );

    expect(documents.map((document) => document.title)).toEqual([
      "Alumnus certificate",
    ]);
  });

  it("moves an employee-file document without leaving access with the previous owner", async () => {
    const { t, organizationId, owner, employee } =
      await setupDocumentAccessFixture();
    const ownerActor = t.withIdentity({ email: owner.email });
    const documentId = await ownerActor.mutation(api.documents.createDocument, {
      organizationId,
      employeeId: owner.employeeId,
      title: "Transferable employee record",
      content: "{}",
      type: "employment",
      visibilityScope: "specific_employee",
    });

    await ownerActor.mutation(api.documents.updateDocument, {
      documentId,
      employeeId: employee.employeeId,
      visibilityScope: "specific_employee",
      visibleDepartments: [],
      visibleEmployeeIds: [],
    });

    const ownerDocuments = await ownerActor.query(api.documents.getDocuments, {
      organizationId,
      employeeExperienceMode: true,
    });
    const employeeDocuments = await t
      .withIdentity({ email: employee.email })
      .query(api.documents.getDocuments, { organizationId });
    expect(ownerDocuments.map((document) => document.title)).not.toContain(
      "Transferable employee record",
    );
    expect(employeeDocuments.map((document) => document.title)).toContain(
      "Transferable employee record",
    );
  });

  it("rejects employee-file owners from another organization", async () => {
    const { t, organizationId, owner } = await setupDocumentAccessFixture();
    const externalEmployeeId = await t.run(async (ctx) => {
      const externalOrganizationId = await ctx.db.insert("organizations", {
        name: "External Org",
        createdAt: 1,
        updatedAt: 1,
      });
      return await ctx.db.insert("employees", {
        organizationId: externalOrganizationId,
        personalInfo: {
          firstName: "External",
          lastName: "Employee",
          email: "external@example.com",
        },
        employment: {
          employeeId: "external",
          position: "Specialist",
          department: "External",
          employmentType: "regular",
          hireDate: 1,
          status: "active",
        },
        compensation: { basicSalary: 30_000, salaryType: "monthly" },
        schedule,
        createdAt: 1,
        updatedAt: 1,
      });
    });
    const ownerActor = t.withIdentity({ email: owner.email });

    await expect(
      ownerActor.mutation(api.documents.createDocument, {
        organizationId,
        employeeId: externalEmployeeId,
        title: "Cross-org employee file",
        content: "{}",
        type: "employment",
        visibilityScope: "specific_employee",
      }),
    ).rejects.toThrow("Employee document owner was not found");

  });

  it("allows HR document managers to maintain documents created by another manager", async () => {
    const { t, organizationId, owner, hr } =
      await setupDocumentAccessFixture();
    const documentId = await t
      .withIdentity({ email: owner.email })
      .mutation(api.documents.createDocument, {
        organizationId,
        title: "Shared HR policy",
        content: "{}",
        type: "other",
        visibilityScope: "admins_only",
      });

    await expect(
      t.withIdentity({ email: hr.email }).mutation(
        api.documents.updateDocument,
        {
          documentId,
          title: "Updated HR policy",
        },
      ),
    ).resolves.toEqual({ success: true });
  });

  it("allows HR to review every employee file regardless of employee-facing access", async () => {
    const { t, organizationId, hr } = await setupDocumentAccessFixture();
    const documents = await t.withIdentity({ email: hr.email }).query(
      api.documents.getDocuments,
      { organizationId },
    );

    expect(documents.map((document) => document.title)).toEqual(
      expect.arrayContaining([
        "Owner private record",
        "Owner visible record",
        "Employee visible record",
        "Alumnus certificate",
      ]),
    );
  });
});
