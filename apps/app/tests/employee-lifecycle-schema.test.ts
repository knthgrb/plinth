import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { ensureEmployeeLifecycleBaseline } from "../convex/employeeLifecycle";
import schema from "../convex/schema";

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../convex/**/*.ts")).map(
    ([path, loader]) => [path.replace("../convex/", "./"), loader],
  ),
);

const workday = { in: "09:00", out: "18:00", isWorkday: true };

describe("canonical employee lifecycle schema", () => {
  it("stores a separated employee and its typed lifecycle event", async () => {
    const t = convexTest(schema, modules);

    const stored = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Lifecycle Org",
        createdAt: 1,
        updatedAt: 1,
      });
      const userId = await ctx.db.insert("users", {
        email: "hr@example.com",
        normalizedEmail: "hr@example.com",
        createdAt: 1,
        updatedAt: 1,
      });
      const employeeId = await ctx.db.insert("employees", {
        organizationId,
        personalInfo: {
          firstName: "Absent",
          lastName: "Employee",
          email: "absent@example.com",
        },
        employment: {
          employeeId: "EMP-SEP",
          position: "Analyst",
          department: "Operations",
          employmentType: "regular",
          hireDate: 1,
          status: "separated",
          separationType: "job_abandonment",
          separationDate: 10,
          lastWorkingDay: 5,
          separationReason: "Employment separation finalized after review",
          separationNotes: "Access was suspended while the review was open.",
        },
        compensation: { basicSalary: 30_000, salaryType: "monthly" },
        schedule: {
          defaultSchedule: {
            monday: workday,
            tuesday: workday,
            wednesday: workday,
            thursday: workday,
            friday: workday,
            saturday: { ...workday, isWorkday: false },
            sunday: { ...workday, isWorkday: false },
          },
        },
        createdAt: 1,
        updatedAt: 10,
      });
      const employee = await ctx.db.get(employeeId);
      if (!employee) throw new Error("Employee fixture was not stored");
      await ensureEmployeeLifecycleBaseline(ctx, employee, userId);
      const events = await ctx.db
        .query("employeeLifecycleEvents")
        .withIndex("by_employee_effective_at", (query) =>
          query.eq("employeeId", employeeId),
        )
        .collect();
      return {
        employee,
        events,
      };
    });

    expect(stored.employee?.employment).toMatchObject({
      status: "separated",
      separationType: "job_abandonment",
    });
    expect(stored.events).toHaveLength(2);
    expect(stored.events[1]).toMatchObject({
      type: "separated",
      separationType: "job_abandonment",
    });
  });
});
