import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import schema from "../convex/schema";
import { encryptDraftConfigForDb } from "../convex/payrollRunCrypto";

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

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

async function setup(
  role: "owner" | "admin" | "hr" | "employee" = "owner",
) {
  const t = convexTest(schema, modules);
  const email = `${role}@attendance-hardening.test`;
  const fixture = await t.run(async (ctx) => {
    const organizationId = await ctx.db.insert("organizations", {
      name: "Hardening Org",
      createdAt: 1,
      updatedAt: 1,
    });
    const userId = await ctx.db.insert("users", {
      email,
      createdAt: 1,
      updatedAt: 1,
    });
    const membershipId = await ctx.db.insert("userOrganizations", {
      userId,
      organizationId,
      role,
      accessStatus: "active",
      joinedAt: 1,
      updatedAt: 1,
    });
    const employeeId = await ctx.db.insert("employees", {
      organizationId,
      personalInfo: {
        firstName: "Ada",
        lastName: "Lovelace",
        email: "ada@example.com",
      },
      employment: {
        employeeId: "EMP-001",
        position: "Engineer",
        department: "Technology",
        employmentType: "regular",
        hireDate: Date.UTC(2026, 0, 1),
        status: "active",
      },
      compensation: { basicSalary: 50_000, salaryType: "monthly" },
      schedule,
      createdAt: 1,
      updatedAt: 1,
    });
    if (role === "employee") {
      await ctx.db.patch(membershipId, { employeeId });
    }
    await ctx.db.insert("organizationAttendanceSettings", {
      organizationId,
      attendanceSettings: {
        payrollLockPolicy: {
          lockAttendanceAfterPayrollFinalized: true,
          allowAdminCorrectionWithReason: true,
        },
      },
      migrationVersion: 2,
      createdAt: 1,
      updatedAt: 1,
    });
    const payrollRunId = await ctx.db.insert("payrollRuns", {
      organizationId,
      cutoffStart: Date.UTC(2026, 6, 1),
      cutoffEnd: Date.UTC(2026, 6, 15),
      period: "July 1-15, 2026",
      runType: "regular",
      status: "finalized",
      processedBy: userId,
      createdAt: 1,
      updatedAt: 1,
    });
    return { organizationId, userId, employeeId, payrollRunId };
  });

  return { t, actor: t.withIdentity({ email }), ...fixture };
}

function attendanceInput(
  organizationId: Id<"organizations">,
  employeeId: Id<"employees">,
  date = Date.UTC(2026, 6, 10),
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

async function separateEmployee(
  t: ReturnType<typeof convexTest>,
  employeeId: Id<"employees">,
  status: "resigned" | "terminated",
  separationDate: number,
) {
  await t.run(async (ctx) => {
    const employee = await ctx.db.get(employeeId);
    if (!employee) {
      throw new Error("Employee fixture not found");
    }

    await ctx.db.patch(employeeId, {
      employment: {
        ...employee.employment,
        status,
        separationDate,
      },
      updatedAt: separationDate,
    });
  });
}

describe("attendance payroll locking", () => {
  it.each(["resigned", "terminated"] as const)(
    "allows %s employee attendance backfill through the separation date",
    async (status) => {
      const { t, actor, organizationId, employeeId } = await setup("owner");
      const separationDate = Date.UTC(2026, 7, 10);
      await separateEmployee(t, employeeId, status, separationDate);

      await expect(
        actor.mutation(
          api.attendance.createAttendance,
          attendanceInput(organizationId, employeeId, separationDate),
        ),
      ).resolves.toBeTruthy();
    },
  );

  it.each(["resigned", "terminated"] as const)(
    "rejects %s employee attendance after the separation date",
    async (status) => {
      const { t, actor, organizationId, employeeId } = await setup("owner");
      await separateEmployee(
        t,
        employeeId,
        status,
        Date.UTC(2026, 7, 10),
      );

      await expect(
        actor.mutation(
          api.attendance.createAttendance,
          attendanceInput(
            organizationId,
            employeeId,
            Date.UTC(2026, 7, 11),
          ),
        ),
      ).rejects.toThrow("after the employee's separation date");
    },
  );

  it.each(["resigned", "terminated"] as const)(
    "allows bulk attendance backfill for a %s employee through the separation date",
    async (status) => {
      const { t, actor, organizationId, employeeId } = await setup("owner");
      const separationDate = Date.UTC(2026, 7, 10);
      await separateEmployee(t, employeeId, status, separationDate);

      await expect(
        actor.mutation(api.attendance.bulkCreateAttendance, {
          entries: [
            attendanceInput(
              organizationId,
              employeeId,
              Date.UTC(2026, 7, 9),
            ),
            attendanceInput(organizationId, employeeId, separationDate),
          ],
        }),
      ).resolves.toHaveLength(2);
    },
  );

  it("rejects a bulk attendance batch after an employee's separation date", async () => {
    const { t, actor, organizationId, employeeId } = await setup("owner");
    await separateEmployee(
      t,
      employeeId,
      "resigned",
      Date.UTC(2026, 7, 10),
    );

    await expect(
      actor.mutation(api.attendance.bulkCreateAttendance, {
        entries: [
          attendanceInput(
            organizationId,
            employeeId,
            Date.UTC(2026, 7, 11),
          ),
        ],
      }),
    ).rejects.toThrow("after the employee's separation date");
  });

  it("blocks HR from changing attendance inside a finalized payroll period", async () => {
    const { actor, organizationId, employeeId } = await setup("hr");

    await expect(
      actor.mutation(api.attendance.createAttendance, {
        ...attendanceInput(organizationId, employeeId),
        correctionReason: "Correcting a verified biometric log",
      }),
    ).rejects.toThrow("finalized payroll period");
  });

  it("does not let newer non-locking payroll rows hide a finalized run", async () => {
    const { t, actor, organizationId, employeeId, userId } = await setup("hr");
    await t.run(async (ctx) => {
      for (let index = 0; index < 30; index++) {
        await ctx.db.insert("payrollRuns", {
          organizationId,
          cutoffStart: Date.UTC(2026, 6, 9),
          cutoffEnd: Date.UTC(2026, 6, 9),
          period: `Non-locking ${index}`,
          runType: index % 2 === 0 ? "regular" : "13th_month",
          status: index % 3 === 0 ? "cancelled" : "draft",
          processedBy: userId,
          createdAt: index + 2,
          updatedAt: index + 2,
        });
      }
    });

    await expect(
      actor.mutation(
        api.attendance.createAttendance,
        attendanceInput(organizationId, employeeId),
      ),
    ).rejects.toThrow("finalized payroll period");
  });

  it("does not let a future finalized run lock an earlier attendance date", async () => {
    const { actor, organizationId, employeeId } = await setup("hr");

    await expect(
      actor.mutation(
        api.attendance.createAttendance,
        attendanceInput(
          organizationId,
          employeeId,
          Date.UTC(2026, 5, 30),
        ),
      ),
    ).resolves.toBeTruthy();
  });

  it("allows an owner correction with a reason and records an immutable audit entry", async () => {
    const { t, actor, organizationId, employeeId, payrollRunId, userId } =
      await setup("owner");

    const attendanceId = await actor.mutation(
      api.attendance.createAttendance,
      {
        ...attendanceInput(organizationId, employeeId),
        correctionReason: "Correcting a verified biometric log",
      },
    );

    const audits = await t.run((ctx) =>
      ctx.db.query("attendanceAuditLogs").collect(),
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      organizationId,
      employeeId,
      attendanceId,
      payrollRunId,
      actorUserId: userId,
      actorRole: "owner",
      action: "create",
      correctionReason: "Correcting a verified biometric log",
    });
    expect(JSON.parse(audits[0].afterJson ?? "{}")).toMatchObject({
      actualIn: "09:00",
      status: "present",
    });
  });

  it("requires a correction reason from an owner in a finalized period", async () => {
    const { actor, organizationId, employeeId } = await setup("owner");

    await expect(
      actor.mutation(
        api.attendance.createAttendance,
        attendanceInput(organizationId, employeeId),
      ),
    ).rejects.toThrow("correction reason");
  });

  it("honors an organization policy that disables finalized-period locking", async () => {
    const { t, actor, organizationId, employeeId } = await setup("hr");
    await t.run(async (ctx) => {
      const settings = await ctx.db
        .query("organizationAttendanceSettings")
        .withIndex("by_organization", (query) =>
          query.eq("organizationId", organizationId),
        )
        .unique();
      if (!settings) throw new Error("Fixture settings not found");
      await ctx.db.patch(settings._id, {
        attendanceSettings: {
          payrollLockPolicy: {
            lockAttendanceAfterPayrollFinalized: false,
            allowAdminCorrectionWithReason: true,
          },
        },
      });
    });

    await expect(
      actor.mutation(
        api.attendance.createAttendance,
        attendanceInput(organizationId, employeeId),
      ),
    ).resolves.toBeTruthy();
  });

  it("does not lock an employee omitted from a scoped payroll run", async () => {
    const { t, actor, organizationId, employeeId, payrollRunId } =
      await setup("hr");
    const secondEmployeeId = await t.run(async (ctx) => {
      await ctx.db.patch(payrollRunId, {
        draftConfig: { employeeIds: [employeeId] },
      });
      return ctx.db.insert("employees", {
        organizationId,
        personalInfo: {
          firstName: "Grace",
          lastName: "Hopper",
          email: "grace@example.com",
        },
        employment: {
          employeeId: "EMP-002",
          position: "Engineer",
          department: "Technology",
          employmentType: "regular",
          hireDate: Date.UTC(2026, 0, 1),
          status: "active",
        },
        compensation: { basicSalary: 50_000, salaryType: "monthly" },
        schedule,
        createdAt: 1,
        updatedAt: 1,
      });
    });

    await expect(
      actor.mutation(
        api.attendance.createAttendance,
        attendanceInput(organizationId, secondEmployeeId),
      ),
    ).resolves.toBeTruthy();
  });

  it("does not lock an omitted employee when the scoped payroll config is encrypted", async () => {
    vi.stubEnv("ENCRYPTION_KEY", "attendance-hardening-encryption-key");
    const { t, actor, organizationId, employeeId, payrollRunId } =
      await setup("hr");
    const secondEmployeeId = await t.run(async (ctx) => {
      await ctx.db.patch(payrollRunId, {
        draftConfig: encryptDraftConfigForDb({ employeeIds: [employeeId] }),
      });
      return ctx.db.insert("employees", {
        organizationId,
        personalInfo: {
          firstName: "Katherine",
          lastName: "Johnson",
          email: "katherine@example.com",
        },
        employment: {
          employeeId: "EMP-003",
          position: "Engineer",
          department: "Technology",
          employmentType: "regular",
          hireDate: Date.UTC(2026, 0, 1),
          status: "active",
        },
        compensation: { basicSalary: 50_000, salaryType: "monthly" },
        schedule,
        createdAt: 1,
        updatedAt: 1,
      });
    });

    await expect(
      actor.mutation(
        api.attendance.createAttendance,
        attendanceInput(organizationId, secondEmployeeId),
      ),
    ).resolves.toBeTruthy();
  });

  it("uses payslips to scope legacy finalized runs without readable config", async () => {
    const { t, actor, organizationId, employeeId, payrollRunId } =
      await setup("hr");
    const secondEmployeeId = await t.run(async (ctx) => {
      await ctx.db.patch(payrollRunId, { draftConfig: "unreadable-config" });
      await ctx.db.insert("payslips", {
        organizationId,
        employeeId,
        payrollRunId,
        period: "July 1-15, 2026",
        grossPay: 1,
        deductions: [],
        netPay: 1,
        daysWorked: 1,
        absences: 0,
        lateHours: 0,
        undertimeHours: 0,
        overtimeHours: 0,
        createdAt: 1,
      });
      return ctx.db.insert("employees", {
        organizationId,
        personalInfo: {
          firstName: "Dorothy",
          lastName: "Vaughan",
          email: "dorothy@example.com",
        },
        employment: {
          employeeId: "EMP-004",
          position: "Engineer",
          department: "Technology",
          employmentType: "regular",
          hireDate: Date.UTC(2026, 0, 1),
          status: "active",
        },
        compensation: { basicSalary: 50_000, salaryType: "monthly" },
        schedule,
        createdAt: 1,
        updatedAt: 1,
      });
    });

    await expect(
      actor.mutation(
        api.attendance.createAttendance,
        attendanceInput(organizationId, secondEmployeeId),
      ),
    ).resolves.toBeTruthy();
  });

  it("requires authorization for recalculation and audits the correction", async () => {
    const { t, actor, organizationId, employeeId, payrollRunId } =
      await setup("owner");
    const date = Date.UTC(2026, 6, 10);
    const attendanceId = await t.run((ctx) =>
      ctx.db.insert("attendance", {
        ...attendanceInput(organizationId, employeeId, date),
        createdAt: 1,
        updatedAt: 1,
      }),
    );

    await expect(
      actor.mutation(api.attendance.recalculateEmployeeAttendance, {
        organizationId,
        employeeId,
        startDate: date,
        endDate: date,
      }),
    ).rejects.toThrow("correction reason");

    await actor.mutation(api.attendance.recalculateEmployeeAttendance, {
      organizationId,
      employeeId,
      startDate: date,
      endDate: date,
      correctionReason: "Recalculated after approved schedule correction",
    });

    const audits = await t.run((ctx) =>
      ctx.db
        .query("attendanceAuditLogs")
        .withIndex("by_attendance_created", (query) =>
          query.eq("attendanceId", attendanceId),
        )
        .collect(),
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: "recalculate",
      payrollRunId,
      correctionReason: "Recalculated after approved schedule correction",
    });
  });

  it("recalculates large histories through bounded cursor pages", async () => {
    const { t, actor, organizationId, employeeId } = await setup("owner");
    const startDate = Date.UTC(2027, 0, 1);
    const endDate = startDate + 100 * 24 * 60 * 60 * 1000;
    await t.run(async (ctx) => {
      for (let index = 0; index < 101; index++) {
        const date = startDate + index * 24 * 60 * 60 * 1000;
        await ctx.db.insert("attendance", {
          ...attendanceInput(organizationId, employeeId, date),
          createdAt: date,
          updatedAt: date,
        });
      }
    });

    const first = await actor.mutation(
      api.attendance.recalculateEmployeeAttendance,
      { organizationId, employeeId, startDate, endDate },
    );
    expect(first).toMatchObject({ updated: 100, isDone: false });

    const second = await actor.mutation(
      api.attendance.recalculateEmployeeAttendance,
      {
        organizationId,
        employeeId,
        startDate,
        endDate,
        cursor: first.continueCursor,
      },
    );
    expect(second).toMatchObject({ updated: 1, isDone: true });
    expect(
      await t.run((ctx) => ctx.db.query("attendanceAuditLogs").collect()),
    ).toHaveLength(101);
  });
});

describe("attendance audit history", () => {
  it("records create, update, and delete without losing the deleted snapshot", async () => {
    const { t, actor, organizationId, employeeId } = await setup("owner");
    const date = Date.UTC(2026, 7, 10);
    const attendanceId = await actor.mutation(
      api.attendance.createAttendance,
      attendanceInput(organizationId, employeeId, date),
    );

    await actor.mutation(api.attendance.updateAttendance, {
      attendanceId,
      actualIn: "09:12",
    });
    await actor.mutation(api.attendance.deleteAttendance, { attendanceId });

    const audits = await t.run((ctx) =>
      ctx.db
        .query("attendanceAuditLogs")
        .withIndex("by_attendance_created", (query) =>
          query.eq("attendanceId", attendanceId),
        )
        .collect(),
    );
    expect(audits.map((audit) => audit.action)).toEqual([
      "create",
      "update",
      "delete",
    ]);
    expect(JSON.parse(audits[2].beforeJson ?? "{}")).toMatchObject({
      actualIn: "09:12",
      employeeId,
    });
    expect(await t.run((ctx) => ctx.db.get(attendanceId))).toBeNull();
  });

  it("audits legacy duplicate cleanup during an approved overwrite", async () => {
    const { t, actor, organizationId, employeeId } = await setup("owner");
    const date = Date.UTC(2026, 7, 10);
    const [keptId, duplicateId] = await t.run(async (ctx) => {
      const payload = {
        ...attendanceInput(organizationId, employeeId, date),
        createdAt: 1,
        updatedAt: 1,
      };
      return Promise.all([
        ctx.db.insert("attendance", payload),
        ctx.db.insert("attendance", payload),
      ]);
    });

    await actor.mutation(api.attendance.createAttendance, {
      ...attendanceInput(organizationId, employeeId, date),
      actualIn: "08:55",
      overwriteAttendanceId: keptId,
    });

    const audits = await t.run((ctx) =>
      ctx.db.query("attendanceAuditLogs").collect(),
    );
    expect(audits.map((audit) => audit.action).sort()).toEqual([
      "duplicate_cleanup",
      "update",
    ]);
    expect(audits.find((audit) => audit.action === "duplicate_cleanup")).toMatchObject({
      attendanceId: duplicateId,
      employeeId,
    });
  });

  it("audits every record created by a bulk import", async () => {
    const { t, actor, organizationId, employeeId } = await setup("owner");

    await actor.mutation(api.attendance.bulkCreateAttendance, {
      entries: [
        attendanceInput(organizationId, employeeId, Date.UTC(2026, 7, 11)),
        attendanceInput(organizationId, employeeId, Date.UTC(2026, 7, 12)),
      ],
    });

    const audits = await t.run((ctx) =>
      ctx.db.query("attendanceAuditLogs").collect(),
    );
    expect(audits.map((audit) => audit.action)).toEqual([
      "bulk_create",
      "bulk_create",
    ]);
  });

  it("makes retried attendance import batches idempotent", async () => {
    const { t, actor, organizationId, employeeId } = await setup("owner");
    const entry = {
      ...attendanceInput(
        organizationId,
        employeeId,
        Date.UTC(2026, 7, 14),
      ),
      importKey: "import-session:sheet-1:row-2",
    };

    const first = await actor.mutation(api.attendance.bulkCreateAttendance, {
      entries: [entry],
    });
    const retried = await actor.mutation(api.attendance.bulkCreateAttendance, {
      entries: [entry],
    });

    expect(first[0].action).toBe("created");
    expect(retried).toEqual([{ id: first[0].id, action: "unchanged" }]);
    expect(
      await t.run((ctx) => ctx.db.query("attendance").collect()),
    ).toHaveLength(1);
    expect(
      await t.run((ctx) => ctx.db.query("attendanceAuditLogs").collect()),
    ).toHaveLength(1);
  });

  it("makes retried attendance overwrites idempotent", async () => {
    const { t, actor, organizationId, employeeId } = await setup("owner");
    const date = Date.UTC(2026, 7, 15);
    const attendanceId = await t.run((ctx) =>
      ctx.db.insert("attendance", {
        ...attendanceInput(organizationId, employeeId, date),
        actualIn: "09:30",
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    const entry = {
      ...attendanceInput(organizationId, employeeId, date),
      actualIn: "08:55",
      overwriteAttendanceId: attendanceId,
      importKey: "overwrite-session:sheet-1:row-2",
    };

    const first = await actor.mutation(api.attendance.bulkCreateAttendance, {
      entries: [entry],
    });
    await actor.mutation(api.attendance.updateAttendance, {
      attendanceId,
      remarks: "Reviewed after import",
    });
    const retried = await actor.mutation(api.attendance.bulkCreateAttendance, {
      entries: [entry],
    });

    expect(first[0].action).toBe("updated");
    expect(retried).toEqual([{ id: attendanceId, action: "unchanged" }]);
    expect(await t.run((ctx) => ctx.db.get(attendanceId))).toMatchObject({
      actualIn: "08:55",
      remarks: "Reviewed after import",
      importKey: entry.importKey,
    });
    expect(
      await t.run((ctx) => ctx.db.query("attendanceAuditLogs").collect()),
    ).toHaveLength(2);
  });

  it("rejects oversized attendance write transactions", async () => {
    const { actor, organizationId, employeeId } = await setup("owner");
    const entries = Array.from({ length: 101 }, (_, index) => ({
      ...attendanceInput(
        organizationId,
        employeeId,
        Date.UTC(2027, 0, 1 + index),
      ),
      importKey: `oversized:${index}`,
    }));

    await expect(
      actor.mutation(api.attendance.bulkCreateAttendance, { entries }),
    ).rejects.toThrow("limited to 100 rows");
  });

  it("blocks employee self-punching in a finalized payroll period", async () => {
    const { actor, organizationId } = await setup("employee");
    vi.setSystemTime(new Date("2026-07-10T01:00:00.000Z"));

    await expect(
      actor.mutation(api.attendance.punchSelfAttendance, {
        organizationId,
        action: "in",
      }),
    ).rejects.toThrow("finalized payroll period");

  });

  it("exposes recent audit history to authorized organization managers", async () => {
    const { actor, organizationId, employeeId } = await setup("owner");
    const attendanceId = await actor.mutation(
      api.attendance.createAttendance,
      attendanceInput(organizationId, employeeId, Date.UTC(2026, 7, 13)),
    );

    const history = await actor.query(
      api.attendance.getAttendanceAuditHistory,
      { organizationId, attendanceId },
    );

    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ attendanceId, action: "create" });
  });

  it("does not expose another organization's audit history by attendance ID", async () => {
    const { t, actor, organizationId, userId } = await setup("owner");
    const foreignAttendanceId = await t.run(async (ctx) => {
      const foreignOrganizationId = await ctx.db.insert("organizations", {
        name: "Foreign Org",
        createdAt: 1,
        updatedAt: 1,
      });
      const foreignEmployeeId = await ctx.db.insert("employees", {
        organizationId: foreignOrganizationId,
        personalInfo: {
          firstName: "Foreign",
          lastName: "Employee",
          email: "foreign@example.com",
        },
        employment: {
          employeeId: "FOREIGN-001",
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
      const attendanceId = await ctx.db.insert("attendance", {
        ...attendanceInput(
          foreignOrganizationId,
          foreignEmployeeId,
          Date.UTC(2026, 7, 13),
        ),
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("attendanceAuditLogs", {
        organizationId: foreignOrganizationId,
        employeeId: foreignEmployeeId,
        attendanceId,
        actorUserId: userId,
        actorRole: "owner",
        action: "create",
        createdAt: 1,
      });
      return attendanceId;
    });

    const history = await actor.query(
      api.attendance.getAttendanceAuditHistory,
      { organizationId, attendanceId: foreignAttendanceId },
    );
    expect(history).toEqual([]);
  });

  it("preserves finalized attendance when a holiday is deleted", async () => {
    vi.useFakeTimers();
    const { t, actor, organizationId, employeeId } = await setup("owner");
    const date = Date.UTC(2026, 6, 10);
    const { holidayId, attendanceId } = await t.run(async (ctx) => ({
      holidayId: await ctx.db.insert("holidays", {
        organizationId,
        name: "Locked Holiday",
        date,
        type: "regular",
        isRecurring: false,
        year: 2026,
        createdAt: 1,
        updatedAt: 1,
      }),
      attendanceId: await ctx.db.insert("attendance", {
        ...attendanceInput(organizationId, employeeId, date),
        isHoliday: true,
        holidayType: "regular",
        createdAt: 1,
        updatedAt: 1,
      }),
    }));

    await actor.mutation(api.holidays.deleteHoliday, { holidayId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(await t.run((ctx) => ctx.db.get(attendanceId))).toMatchObject({
      isHoliday: true,
      holidayType: "regular",
    });
    expect(
      await t.run((ctx) => ctx.db.query("attendanceAuditLogs").collect()),
    ).toEqual([]);
  });

  it("audits holiday metadata synchronization outside finalized payroll", async () => {
    vi.useFakeTimers();
    const { t, actor, organizationId, employeeId } = await setup("owner");
    const date = Date.UTC(2026, 7, 10);
    const { holidayId, attendanceId } = await t.run(async (ctx) => ({
      holidayId: await ctx.db.insert("holidays", {
        organizationId,
        name: "Editable Holiday",
        date,
        type: "regular",
        isRecurring: false,
        year: 2026,
        createdAt: 1,
        updatedAt: 1,
      }),
      attendanceId: await ctx.db.insert("attendance", {
        ...attendanceInput(organizationId, employeeId, date),
        isHoliday: true,
        holidayType: "regular",
        createdAt: 1,
        updatedAt: 1,
      }),
    }));

    await actor.mutation(api.holidays.deleteHoliday, { holidayId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(await t.run((ctx) => ctx.db.get(attendanceId))).toMatchObject({
      isHoliday: false,
    });
    const audits = await t.run((ctx) =>
      ctx.db.query("attendanceAuditLogs").collect(),
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      attendanceId,
      action: "holiday_sync",
    });
  });
});

describe("attendance pagination", () => {
  it("returns indexed date-range pages without loading the whole organization", async () => {
    const { t, actor, organizationId, employeeId } = await setup("owner");
    await t.run(async (ctx) => {
      for (const day of [10, 11, 12]) {
        const date = Date.UTC(2026, 7, day);
        await ctx.db.insert("attendance", {
          ...attendanceInput(organizationId, employeeId, date),
          createdAt: date,
          updatedAt: date,
        });
      }
    });

    const first = await actor.query(api.attendance.getAttendancePage, {
      organizationId,
      startDate: Date.UTC(2026, 7, 1),
      endDate: Date.UTC(2026, 7, 31),
      paginationOpts: { cursor: null, numItems: 2 },
    });
    expect(first.page).toHaveLength(2);
    expect(first.isDone).toBe(false);

    const second = await actor.query(api.attendance.getAttendancePage, {
      organizationId,
      startDate: Date.UTC(2026, 7, 1),
      endDate: Date.UTC(2026, 7, 31),
      paginationOpts: { cursor: first.continueCursor, numItems: 2 },
    });
    expect(second.page).toHaveLength(1);
    expect(second.isDone).toBe(true);
  });

  it("loads summary attendance only for the requested employee page", async () => {
    const { t, actor, organizationId, employeeId } = await setup("owner");
    const secondEmployeeId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("employees", {
        organizationId,
        personalInfo: {
          firstName: "Mary",
          lastName: "Jackson",
          email: "mary@example.com",
        },
        employment: {
          employeeId: "EMP-005",
          position: "Engineer",
          department: "Technology",
          employmentType: "regular",
          hireDate: 1,
          status: "active",
        },
        compensation: { basicSalary: 50_000, salaryType: "monthly" },
        schedule,
        createdAt: 1,
        updatedAt: 1,
      });
      for (const targetEmployeeId of [employeeId, id]) {
        await ctx.db.insert("attendance", {
          ...attendanceInput(
            organizationId,
            targetEmployeeId,
            Date.UTC(2026, 7, 10),
          ),
          createdAt: 1,
          updatedAt: 1,
        });
      }
      return id;
    });

    const page = await actor.query(api.attendance.getAttendanceForEmployees, {
      organizationId,
      employeeIds: [secondEmployeeId],
      startDate: Date.UTC(2026, 7, 1),
      endDate: Date.UTC(2026, 7, 31),
    });
    expect(page).toHaveLength(1);
    expect(page[0].employeeId).toBe(secondEmployeeId);
  });

  it("looks up import conflicts by exact employee and day keys", async () => {
    const { t, actor, organizationId, employeeId } = await setup("owner");
    const matchingDate = Date.UTC(2026, 7, 10);
    await t.run(async (ctx) => {
      await ctx.db.insert("attendance", {
        ...attendanceInput(organizationId, employeeId, matchingDate),
        createdAt: 1,
        updatedAt: 1,
      });
      for (let day = 1; day <= 25; day++) {
        await ctx.db.insert("attendance", {
          ...attendanceInput(
            organizationId,
            employeeId,
            Date.UTC(2025, 0, day),
          ),
          createdAt: 1,
          updatedAt: 1,
        });
      }
    });

    const conflicts = await actor.action(
      api.attendance.getAttendanceImportConflicts,
      {
        organizationId,
        entries: [{ employeeId, date: matchingDate }],
      },
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ employeeId, date: matchingDate });
  });

  it("reviews exact import rows for finalized payroll corrections", async () => {
    const { actor, organizationId, employeeId } = await setup("owner");
    const lockedDate = Date.UTC(2026, 6, 10);
    const unlockedDate = Date.UTC(2026, 7, 10);

    const review = await actor.action(
      api.attendance.getAttendanceImportReview,
      {
        organizationId,
        entries: [
          { employeeId, date: lockedDate },
          { employeeId, date: unlockedDate },
        ],
      },
    );

    expect(review.conflicts).toEqual([]);
    expect(review.lockedEntries).toEqual([
      { employeeId, date: lockedDate },
    ]);
    expect(review.canCorrectWithReason).toBe(true);
  });

  it("does not offer reason-based payroll corrections to HR members", async () => {
    const { actor, organizationId, employeeId } = await setup("hr");
    const lockedDate = Date.UTC(2026, 6, 10);

    const review = await actor.action(
      api.attendance.getAttendanceImportReview,
      {
        organizationId,
        entries: [{ employeeId, date: lockedDate }],
      },
    );

    expect(review.lockedEntries).toEqual([
      { employeeId, date: lockedDate },
    ]);
    expect(review.canCorrectWithReason).toBe(false);
  });
});
