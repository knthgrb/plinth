import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { makeFunctionReference } from "convex/server";
import { getPayslipPdfOpenPassword } from "@/lib/payslip-pdf-password";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";

const rawModules = import.meta.glob("../../convex/**/*.ts");
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => [
    path.replace("../../convex/", "./"),
    loader,
  ]),
);

const clearLegacyPdfPasswords = makeFunctionReference<
  "mutation",
  { organizationId: Id<"organizations">; dryRun: boolean },
  { employeeRows: number; snapshotRows: number; dryRun: boolean }
>("payslipSecurityMigrations:clearLegacyPdfPasswords");

describe("payslip PDF password", () => {
  it("does not use a stored custom plaintext password", () => {
    const password = getPayslipPdfOpenPassword({
      personalInfo: {},
      employment: { employeeId: "EMP-0042" },
      payslipPdfPassword: "plaintext-secret",
    });

    expect(password).toBe("EMP-0042");
  });

  it("dry-runs and clears legacy plaintext employee passwords", async () => {
    const t = convexTest(schema, modules);
    const { organizationId, employeeId } = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Migration organization",
        createdAt: 1,
        updatedAt: 1,
      });
      const day = { in: "09:00", out: "18:00", isWorkday: true };
      const employeeId = await ctx.db.insert("employees", {
        organizationId,
        personalInfo: {
          firstName: "Employee",
          lastName: "One",
          email: "employee@example.com",
        },
        employment: {
          employeeId: "EMP-0042",
          position: "Analyst",
          department: "Operations",
          employmentType: "regular",
          hireDate: 1,
          status: "active",
        },
        compensation: { basicSalary: 30_000, salaryType: "monthly" },
        schedule: {
          defaultSchedule: {
            monday: day,
            tuesday: day,
            wednesday: day,
            thursday: day,
            friday: day,
            saturday: { ...day, isWorkday: false },
            sunday: { ...day, isWorkday: false },
          },
        },
        payslipPdfPassword: "plaintext-secret",
        createdAt: 1,
        updatedAt: 1,
      });
      return { organizationId, employeeId };
    });

    await expect(
      t.mutation(clearLegacyPdfPasswords, { organizationId, dryRun: true }),
    ).resolves.toMatchObject({ employeeRows: 1, snapshotRows: 0, dryRun: true });
    expect((await t.run((ctx) => ctx.db.get(employeeId)))?.payslipPdfPassword).toBe(
      "plaintext-secret",
    );

    await expect(
      t.mutation(clearLegacyPdfPasswords, { organizationId, dryRun: false }),
    ).resolves.toMatchObject({ employeeRows: 1, snapshotRows: 0, dryRun: false });
    expect(
      (await t.run((ctx) => ctx.db.get(employeeId)))?.payslipPdfPassword,
    ).toBeUndefined();
  });
});
