import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import type { MutationCtx } from "../convex/_generated/server";
import type { Id } from "../convex/_generated/dataModel";
import schema from "../convex/schema";

const rawModules = import.meta.glob("../convex/**/*.ts");
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => [
    path.replace("../convex/", "./"),
    loader,
  ]),
);

const insertMinimalEmployee = async (
  ctx: MutationCtx,
  organizationId: Id<"organizations">,
) => {
  const workday = { in: "09:00", out: "18:00", isWorkday: true };
  return ctx.db.insert("employees", {
    organizationId,
    personalInfo: {
      firstName: "Identity",
      lastName: "Employee",
      email: "employee@example.com",
    },
    employment: {
      employeeId: "IDENTITY-001",
      position: "Analyst",
      department: "Operations",
      employmentType: "regular",
      hireDate: 1,
      status: "active",
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
    updatedAt: 1,
  });
};

describe("identity credentials schema", () => {
  it("stores private payslip credentials and hashed invitation compatibility data", async () => {
    const t = convexTest(schema, modules);
    const result = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Identity Org",
        createdAt: 1,
        updatedAt: 1,
      });
      const employeeId = await insertMinimalEmployee(ctx, organizationId);
      const userId = await ctx.db.insert("users", {
        email: "member@example.com",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("userOrganizations", {
        userId,
        organizationId,
        employeeId,
        role: "employee",
        accessStatus: "active",
        joinedAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("payslipCredentials", {
        organizationId,
        employeeId,
        credentialHash: "redacted-fixture-hash",
        credentialVersion: 1,
        migrationVersion: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("invitations", {
        organizationId,
        email: "invitee@example.com",
        role: "employee",
        invitedBy: userId,
        tokenHash: "redacted-invitation-token-hash",
        status: "pending",
        expiresAt: 2,
        createdAt: 1,
      });

      return {
        memberships: await ctx.db
          .query("userOrganizations")
          .withIndex("by_organization_employee", (q) =>
            q.eq("organizationId", organizationId).eq("employeeId", employeeId),
          )
          .take(2),
        invitations: await ctx.db
          .query("invitations")
          .withIndex("by_token_hash", (q) =>
            q.eq("tokenHash", "redacted-invitation-token-hash"),
          )
          .take(2),
      };
    });

    expect(result.memberships).toHaveLength(1);
    expect(result.invitations).toHaveLength(1);
  });
});
