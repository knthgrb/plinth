import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";

vi.mock("../../convex/auth", () => ({
  authComponent: {
    getAuthUser: async (ctx: {
      auth: { getUserIdentity: () => Promise<{ email?: string } | null> };
    }) => ctx.auth.getUserIdentity(),
  },
}));

const rawModules = import.meta.glob("../../convex/**/*.ts");
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => [
    path.replace("../../convex/", "./"),
    loader,
  ]),
);

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

describe("alumni document access", () => {
  it("returns only alumni-visible documents and rejects document writes", async () => {
    const t = convexTest(schema, modules);
    const alumniEmail = "alumni-documents@example.com";
    const fixture = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Past Employer",
        createdAt: 1,
        updatedAt: 1,
      });
      const userId = await ctx.db.insert("users", {
        email: alumniEmail,
        createdAt: 1,
        updatedAt: 1,
      });
      const employeeId = await ctx.db.insert("employees", {
        organizationId,
        personalInfo: {
          firstName: "Past",
          lastName: "Employee",
          email: alumniEmail,
        },
        employment: {
          employeeId: "EMP-ALUMNI-DOC",
          position: "Analyst",
          department: "Operations",
          employmentType: "regular",
          hireDate: 1,
          status: "resigned",
        },
        compensation: { basicSalary: 30_000, salaryType: "monthly" },
        schedule: { defaultSchedule },
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("userOrganizations", {
        userId,
        organizationId,
        employeeId,
        role: "employee",
        accessStatus: "alumni",
        joinedAt: 1,
        updatedAt: 1,
      });
      const alumniDocumentId = await ctx.db.insert("documents", {
        organizationId,
        createdBy: userId,
        title: "Certificate of Employment",
        content: "{}",
        type: "certificate",
        visibilityScope: "alumni_visible",
        createdAt: 1,
        updatedAt: 1,
      });
      const storageId = await ctx.storage.store(
        new Blob(["employment certificate"], { type: "text/plain" }),
      );
      await ctx.db.insert("storageObjectLinks", {
        organizationId,
        storageId,
        parentType: "document",
        parentId: alumniDocumentId,
        purpose: "document_attachment",
        sourceIndex: 0,
        migrationVersion: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      const unrelatedStorageId = await ctx.storage.store(
        new Blob(["unrelated private file"], { type: "text/plain" }),
      );
      await ctx.db.insert("documents", {
        organizationId,
        createdBy: userId,
        title: "Internal Handbook",
        content: "{}",
        type: "other",
        visibilityScope: "all_employees",
        createdAt: 1,
        updatedAt: 1,
      });
      return {
        organizationId,
        alumniDocumentId,
        storageId,
        unrelatedStorageId,
      };
    });

    const alumni = t.withIdentity({ email: alumniEmail });
    const documents = await alumni.query(api.documents.getDocuments, {
      organizationId: fixture.organizationId,
    });
    expect(documents.map((document) => document.title)).toEqual([
      "Certificate of Employment",
    ]);
    await expect(
      alumni.query(api.documents.getDocument, {
        documentId: fixture.alumniDocumentId,
      }),
    ).resolves.toMatchObject({ title: "Certificate of Employment" });
    await expect(
      alumni.query(api.documents.getDocumentAttachmentUrl, {
        organizationId: fixture.organizationId,
        documentId: fixture.alumniDocumentId,
        storageId: fixture.storageId,
      }),
    ).resolves.toContain("http");
    await expect(
      alumni.query(api.documents.getDocumentAttachmentUrl, {
        organizationId: fixture.organizationId,
        documentId: fixture.alumniDocumentId,
        storageId: fixture.unrelatedStorageId,
      }),
    ).rejects.toThrow("Not authorized to access this attachment");
    await expect(
      alumni.query(api.files.getFileUrl, {
        organizationId: fixture.organizationId,
        storageId: fixture.storageId,
      }),
    ).rejects.toThrow("Not authorized");
    await expect(
      alumni.mutation(api.documents.createDocument, {
        organizationId: fixture.organizationId,
        title: "Unauthorized document",
        content: "{}",
        type: "other",
      }),
    ).rejects.toThrow("Not authorized");
  });
});
