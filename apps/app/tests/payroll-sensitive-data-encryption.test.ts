import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  decryptAccountingCostBreakdown,
  encryptAccountingCostBreakdown,
} from "../convex/accountingCostItemCrypto";
import {
  decryptAttendanceAuditCorrectionReason,
  encryptAttendanceAuditCorrectionReason,
} from "../convex/attendanceAuditCrypto";
import {
  decryptPayrollJournalReason,
  decryptPayrollVoidReason,
  encryptPayrollJournalReason,
  encryptPayrollVoidReason,
} from "../convex/payrollSensitiveCrypto";
import {
  loadEffectiveEmployeePaymentAccount,
  replaceEmployeePaymentAccount,
} from "../convex/leaveEmployeeCompatibility";
import schema from "../convex/schema";

const rawModules = import.meta.glob("../convex/**/*.ts");
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => [
    path.replace("../convex/", "./"),
    loader,
  ]),
);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("payroll sensitive storage", () => {
  it("encrypts payroll and attendance audit reasons by domain", () => {
    vi.stubEnv("ENCRYPTION_KEY", "0123456789abcdef0123456789abcdef");
    const voidReason = encryptPayrollVoidReason("Duplicate bank release");
    const journalReason = encryptPayrollJournalReason("Correction approved");
    const attendanceReason = encryptAttendanceAuditCorrectionReason(
      "Biometric device outage",
    );

    expect(voidReason).toMatch(/^pp:enc:v1:/);
    expect(journalReason).toMatch(/^pp:enc:v1:/);
    expect(attendanceReason).toMatch(/^pp:enc:v1:/);
    expect(voidReason).not.toBe(journalReason);
    expect(decryptPayrollVoidReason(voidReason)).toBe(
      "Duplicate bank release",
    );
    expect(decryptPayrollJournalReason(journalReason)).toBe(
      "Correction approved",
    );
    expect(decryptAttendanceAuditCorrectionReason(attendanceReason)).toBe(
      "Biometric device outage",
    );
  });

  it("encrypts employee-level accounting breakdowns", () => {
    vi.stubEnv("ENCRYPTION_KEY", "0123456789abcdef0123456789abcdef");
    const breakdown = {
      kind: "payroll" as const,
      rows: [
        {
          employeeId: "employee-id" as never,
          employeeName: "Sensitive Name",
          grossPay: 25_000,
          netPay: 20_000,
        },
      ],
    };

    const stored = encryptAccountingCostBreakdown(breakdown);

    expect(stored).toMatch(/^pp:enc:v1:/);
    expect(stored).not.toContain("Sensitive Name");
    expect(decryptAccountingCostBreakdown(stored)).toEqual(breakdown);
  });

  it("encrypts bank account fields at rest and decrypts them at the boundary", async () => {
    vi.stubEnv("ENCRYPTION_KEY", "0123456789abcdef0123456789abcdef");
    const t = convexTest(schema, modules);
    const result = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Encrypted Payroll Org",
        createdAt: 1,
        updatedAt: 1,
      });
      const employeeId = await ctx.db.insert("employees", {
        organizationId,
        personalInfo: {
          firstName: "Encrypted",
          lastName: "Employee",
          email: "encrypted@example.com",
        },
        employment: {
          employeeId: "ENC-001",
          position: "Engineer",
          department: "Security",
          employmentType: "regular",
          hireDate: 1,
          status: "active",
        },
        compensation: { basicSalary: 10_000, salaryType: "monthly" },
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
      const employee = await ctx.db.get(employeeId);
      if (!employee) throw new Error("Employee missing");
      await replaceEmployeePaymentAccount(
        ctx,
        employee,
        {
          bankName: "Example Bank",
          accountNumber: "001234567890",
          accountName: "Encrypted Employee",
        },
        2,
      );
      const raw = await ctx.db
        .query("employeePaymentAccounts")
        .withIndex("by_employee", (query) => query.eq("employeeId", employeeId))
        .unique();
      const loaded = await loadEffectiveEmployeePaymentAccount(ctx, employee);
      return { raw, loaded };
    });

    expect(result.raw?.bankName).toMatch(/^pp:enc:v1:/);
    expect(result.raw?.accountNumber).toMatch(/^pp:enc:v1:/);
    expect(result.raw?.accountName).toMatch(/^pp:enc:v1:/);
    expect(JSON.stringify(result.raw)).not.toContain("001234567890");
    expect(result.loaded).toEqual({
      bankName: "Example Bank",
      accountNumber: "001234567890",
      accountName: "Encrypted Employee",
    });
  });
});
