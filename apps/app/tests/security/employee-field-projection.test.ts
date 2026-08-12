import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import { decryptEmployeeFromDb } from "../../convex/employeeCompensationCrypto";

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

const day = { in: "09:00", out: "18:00", isWorkday: true };
const defaultSchedule = {
  monday: day,
  tuesday: day,
  wednesday: day,
  thursday: day,
  friday: day,
  saturday: { ...day, isWorkday: false },
  sunday: { ...day, isWorkday: false },
};

describe("employee field projection", () => {
  it("never projects payslip credentials from employee records", () => {
    const projected = decryptEmployeeFromDb({
      compensation: { basicSalary: 30_000 },
      payslipPinHash: "scrypt$v1$private",
      payslipPdfPassword: "plaintext-private",
    });

    expect(projected).not.toHaveProperty("payslipPinHash");
    expect(projected).not.toHaveProperty("payslipPdfPassword");
  });

  it("omits compensation, banking, and private contact fields for employee viewers", async () => {
    const t = convexTest(schema, modules);
    const viewerEmail = "viewer@example.com";

    const organizationId = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Directory Org",
        createdAt: 1,
        updatedAt: 1,
      });
      const viewerUserId = await ctx.db.insert("users", {
        email: viewerEmail,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("userOrganizations", {
        userId: viewerUserId,
        organizationId,
        role: "employee",
        accessStatus: "active",
        joinedAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("employees", {
        organizationId,
        personalInfo: {
          firstName: "Private",
          lastName: "Employee",
          email: "private@example.com",
          phone: "+639171234567",
          address: "Private address",
          emergencyContact: {
            name: "Emergency Contact",
            relationship: "Sibling",
            phone: "+639181234567",
          },
        },
        employment: {
          employeeId: "EMP-PRIVATE",
          position: "Analyst",
          department: "Operations",
          employmentType: "regular",
          hireDate: 1,
          status: "active",
        },
        compensation: {
          basicSalary: 100_000,
          salaryType: "monthly",
          bankDetails: {
            bankName: "Private Bank",
            accountNumber: "1234567890",
            accountName: "Private Employee",
          },
        },
        schedule: { defaultSchedule },
        createdAt: 1,
        updatedAt: 1,
      });
      return organizationId;
    });

    const employees = await t
      .withIdentity({ email: viewerEmail })
      .query(api.employees.getEmployees, { organizationId });

    expect(employees).toHaveLength(1);
    expect(employees[0]).not.toHaveProperty("compensation");
    expect(employees[0]).not.toHaveProperty("schedule");
    expect(employees[0].personalInfo).not.toHaveProperty("phone");
    expect(employees[0].personalInfo).not.toHaveProperty("address");
    expect(employees[0].personalInfo).not.toHaveProperty("emergencyContact");
  });
});
