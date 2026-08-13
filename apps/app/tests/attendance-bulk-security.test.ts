import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";

import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
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
} as const;

async function setup() {
  const t = convexTest(schema, modules);
  const email = "attendance-hr@example.com";
  const fixture = await t.run(async (ctx) => {
    const organizationId = await ctx.db.insert("organizations", {
      name: "Attendance Org",
      createdAt: 1,
      updatedAt: 1,
    });
    const foreignOrganizationId = await ctx.db.insert("organizations", {
      name: "Foreign Org",
      createdAt: 1,
      updatedAt: 1,
    });
    const userId = await ctx.db.insert("users", {
      email,
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("userOrganizations", {
      userId,
      organizationId,
      role: "hr",
      accessStatus: "active",
      joinedAt: 1,
      updatedAt: 1,
    });

    const insertEmployee = (
      employeeOrganizationId: Id<"organizations">,
      companyId: string,
    ) =>
      ctx.db.insert("employees", {
        organizationId: employeeOrganizationId,
        personalInfo: {
          firstName: companyId,
          lastName: "Employee",
          email: `${companyId.toLowerCase()}@example.com`,
        },
        employment: {
          employeeId: companyId,
          position: "Analyst",
          department: "Operations",
          employmentType: "regular",
          hireDate: 1,
          status: "active",
        },
        compensation: { basicSalary: 30_000, salaryType: "monthly" },
        schedule,
        createdAt: 1,
        updatedAt: 1,
      });

    const employeeId = await insertEmployee(organizationId, "EMP-001");
    const secondEmployeeId = await insertEmployee(organizationId, "EMP-002");
    const foreignEmployeeId = await insertEmployee(
      foreignOrganizationId,
      "FOREIGN-001",
    );

    return {
      organizationId,
      foreignOrganizationId,
      employeeId,
      secondEmployeeId,
      foreignEmployeeId,
    };
  });

  return { t, actor: t.withIdentity({ email }), ...fixture };
}

function entry(
  organizationId: Id<"organizations">,
  employeeId: Id<"employees">,
  date: number,
) {
  return {
    organizationId,
    employeeId,
    date,
    scheduleIn: "09:00",
    scheduleOut: "18:00",
    actualIn: "09:00",
    actualOut: "18:00",
    status: "present" as const,
  };
}

describe("bulk attendance tenant boundary", () => {
  it("rejects an empty batch", async () => {
    const { actor } = await setup();

    await expect(
      actor.mutation(api.attendance.bulkCreateAttendance, { entries: [] }),
    ).rejects.toThrow("empty");
  });

  it("rejects mixed organization entry IDs without writes", async () => {
    const {
      t,
      actor,
      organizationId,
      foreignOrganizationId,
      employeeId,
      foreignEmployeeId,
    } = await setup();

    await expect(
      actor.mutation(api.attendance.bulkCreateAttendance, {
        entries: [
          entry(organizationId, employeeId, Date.UTC(2026, 7, 17)),
          entry(
            foreignOrganizationId,
            foreignEmployeeId,
            Date.UTC(2026, 7, 18),
          ),
        ],
      }),
    ).rejects.toThrow("same organization");

    const records = await t.run((ctx) => ctx.db.query("attendance").collect());
    expect(records).toEqual([]);
  });

  it("rejects a foreign employee ID without writes", async () => {
    const { t, actor, organizationId, foreignEmployeeId } = await setup();

    await expect(
      actor.mutation(api.attendance.bulkCreateAttendance, {
        entries: [
          entry(organizationId, foreignEmployeeId, Date.UTC(2026, 7, 17)),
        ],
      }),
    ).rejects.toThrow("Employee does not belong");

    const records = await t.run((ctx) => ctx.db.query("attendance").collect());
    expect(records).toEqual([]);
  });

  it("creates a valid same-organization batch", async () => {
    const { t, actor, organizationId, employeeId, secondEmployeeId } =
      await setup();

    await actor.mutation(api.attendance.bulkCreateAttendance, {
      entries: [
        entry(organizationId, employeeId, Date.UTC(2026, 7, 17)),
        entry(organizationId, secondEmployeeId, Date.UTC(2026, 7, 18)),
      ],
    });

    const records = await t.run((ctx) => ctx.db.query("attendance").collect());
    expect(records).toHaveLength(2);
    expect(records.every((record) => record.organizationId === organizationId))
      .toBe(true);
  });
});
