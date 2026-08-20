import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";

import { api } from "../convex/_generated/api";
import type { MutationCtx } from "../convex/_generated/server";
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

const schedule = {
  defaultSchedule: {
    monday: { in: "09:00", out: "18:00", isWorkday: true },
    tuesday: { in: "09:00", out: "18:00", isWorkday: true },
    wednesday: { in: "09:00", out: "18:00", isWorkday: true },
    thursday: { in: "09:00", out: "18:00", isWorkday: true },
    friday: { in: "09:00", out: "18:00", isWorkday: true },
    saturday: { in: "09:00", out: "18:00", isWorkday: false },
    sunday: { in: "09:00", out: "18:00", isWorkday: false },
  },
};

async function seed(ctx: MutationCtx) {
  const organizationId = await ctx.db.insert("organizations", {
    name: "PDF Authorization Org",
    createdAt: 1,
    updatedAt: 1,
  });
  const ownerId = await ctx.db.insert("users", {
    email: "pdf-owner@example.com",
    createdAt: 1,
    updatedAt: 1,
  });
  const employeeId = await ctx.db.insert("employees", {
    organizationId,
    personalInfo: {
      firstName: "PDF",
      lastName: "Employee",
      email: "pdf-employee@example.com",
    },
    employment: {
      employeeId: "PDF-001",
      position: "Analyst",
      department: "Finance",
      employmentType: "regular",
      hireDate: 1,
      status: "active",
    },
    compensation: { basicSalary: 30_000, salaryType: "monthly" },
    schedule,
    createdAt: 1,
    updatedAt: 1,
  });
  const otherEmployeeId = await ctx.db.insert("employees", {
    organizationId,
    personalInfo: {
      firstName: "Other",
      lastName: "Employee",
      email: "other-pdf-employee@example.com",
    },
    employment: {
      employeeId: "PDF-002",
      position: "Analyst",
      department: "Finance",
      employmentType: "regular",
      hireDate: 1,
      status: "active",
    },
    compensation: { basicSalary: 30_000, salaryType: "monthly" },
    schedule,
    createdAt: 1,
    updatedAt: 1,
  });
  for (const [email, linkedEmployeeId] of [
    ["pdf-employee@example.com", employeeId],
    ["other-pdf-employee@example.com", otherEmployeeId],
  ] as const) {
    const userId = await ctx.db.insert("users", {
      email,
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("userOrganizations", {
      organizationId,
      userId,
      employeeId: linkedEmployeeId,
      role: "employee",
      accessStatus: "active",
      joinedAt: 1,
      updatedAt: 1,
    });
  }
  const payrollRunId = await ctx.db.insert("payrollRuns", {
    organizationId,
    cutoffStart: 100,
    cutoffEnd: 200,
    period: "PDF period",
    runType: "regular",
    status: "finalized",
    processedBy: ownerId,
    createdAt: 1,
    updatedAt: 1,
  });
  const payslipId = await ctx.db.insert("payslips", {
    organizationId,
    employeeId,
    payrollRunId,
    period: "PDF period",
    periodStart: 100,
    periodEnd: 200,
    grossPay: 15_000,
    deductions: [],
    netPay: 15_000,
    daysWorked: 10,
    absences: 0,
    lateHours: 0,
    undertimeHours: 0,
    overtimeHours: 0,
    createdAt: 1,
  });
  return { payrollRunId, payslipId };
}

describe("payslip PDF authorization", () => {
  it("lets an employee load only their own finalized PDF context", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seed);
    const employee = t.withIdentity({ email: "pdf-employee@example.com" });
    const otherEmployee = t.withIdentity({
      email: "other-pdf-employee@example.com",
    });

    await expect(
      employee.query(api.payroll.getPayslipPdfContext, {
        payslipId: fixture.payslipId,
      }),
    ).resolves.toMatchObject({
      organizationName: "PDF Authorization Org",
      cutoffStart: 100,
      cutoffEnd: 200,
    });
    await expect(
      otherEmployee.query(api.payroll.getPayslipPdfContext, {
        payslipId: fixture.payslipId,
      }),
    ).rejects.toThrow("Not authorized");

    await t.run((ctx) =>
      ctx.db.patch(fixture.payrollRunId, { status: "draft" }),
    );
    await expect(
      employee.query(api.payroll.getPayslipPdfContext, {
        payslipId: fixture.payslipId,
      }),
    ).rejects.toThrow("Not authorized");
  });
});
