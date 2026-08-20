import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../convex/_generated/api";
import type { Doc } from "../convex/_generated/dataModel";
import { decryptPayslipRowFromDb } from "../convex/payslipCrypto";
import {
  decryptDraftConfigFromDb,
  encryptDraftConfigForDb,
} from "../convex/payrollRunCrypto";
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

afterEach(() => {
  vi.unstubAllEnvs();
});

const schedule: Doc<"employees">["schedule"] = {
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

type PayrollLine = {
  name: string;
  amount: number;
  type: string;
  taxable?: boolean;
};

type VariableEarnings = {
  holidayPay: number;
  nightDiffPay: number;
  restDayPay: number;
  overtimeRegular: number;
  overtimeRestDay: number;
  overtimeRestDayExcess: number;
  overtimeSpecialHoliday: number;
  overtimeSpecialHolidayExcess: number;
  overtimeLegalHoliday: number;
  overtimeLegalHolidayExcess: number;
};

type RegenerationDraftConfig = {
  payslipOverrides?: Array<{
    deductions?: PayrollLine[];
  }>;
  overrideReview?: {
    status: "needs_review" | "reviewed";
    employees: Array<{ employeeId: string; fields: string[] }>;
  };
};

function manilaMidnightUtc(year: number, monthIndex: number, day: number) {
  return Date.UTC(year, monthIndex, day - 1, 16, 0, 0, 0);
}

async function setupOutdatedDraftWithOverrides(options?: {
  incentiveOverride?: PayrollLine[];
  runIncentives?: PayrollLine[];
  variableEarningsOverride?: VariableEarnings | null;
  omitGovernmentSettings?: boolean;
}) {
  const t = convexTest(schema, modules);
  const email = "payroll-regeneration-owner@example.com";
  const cutoffStart = manilaMidnightUtc(2026, 7, 1);
  const cutoffEnd = manilaMidnightUtc(2026, 7, 15);
  const fixture = await t.run(async (ctx) => {
    const organizationId = await ctx.db.insert("organizations", {
      name: "Regeneration Test Org",
      createdAt: 1,
      updatedAt: 1,
    });
    const ownerId = await ctx.db.insert("users", {
      email,
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("userOrganizations", {
      userId: ownerId,
      organizationId,
      role: "owner",
      accessStatus: "active",
      joinedAt: 1,
      updatedAt: 1,
    });
    const employeeId = await ctx.db.insert("employees", {
      organizationId,
      personalInfo: {
        firstName: "Regina",
        lastName: "Pay",
        email: "regina.pay@example.com",
      },
      employment: {
        employeeId: "PAY-001",
        position: "Engineer",
        department: "Product",
        employmentType: "regular",
        hireDate: manilaMidnightUtc(2025, 0, 1),
        status: "active",
      },
      compensation: { basicSalary: 5_000, salaryType: "daily" },
      schedule,
      createdAt: 1,
      updatedAt: 2,
    });

    for (const day of [3, 4, 5, 6, 7, 10, 11, 12, 13, 14]) {
      await ctx.db.insert("attendance", {
        organizationId,
        employeeId,
        date: manilaMidnightUtc(2026, 7, day),
        scheduleIn: "09:00",
        scheduleOut: "18:00",
        actualIn: "09:00",
        actualOut: "18:00",
        status: "present",
        createdAt: 1,
        updatedAt: 1,
      });
    }

    const incentiveOverride = options?.incentiveOverride ?? [
      { name: "Project bonus", amount: 1_000, type: "incentive" },
    ];
    const variableEarningsOverride =
      options?.variableEarningsOverride === undefined
        ? {
            holidayPay: 0,
            nightDiffPay: 0,
            restDayPay: 0,
            overtimeRegular: 500,
            overtimeRestDay: 0,
            overtimeRestDayExcess: 0,
            overtimeSpecialHoliday: 0,
            overtimeSpecialHolidayExcess: 0,
            overtimeLegalHoliday: 0,
            overtimeLegalHolidayExcess: 0,
          }
        : options.variableEarningsOverride;
    const payrollRunId = await ctx.db.insert("payrollRuns", {
      organizationId,
      cutoffStart,
      cutoffEnd,
      period: "08/01/2026 to 08/15/2026",
      runType: "regular",
      status: "draft",
      processedBy: ownerId,
      deductionsEnabled: true,
      draftConfig: encryptDraftConfigForDb({
        employeeIds: [employeeId],
        governmentDeductionSettings: options?.omitGovernmentSettings
          ? undefined
          : [
              {
                employeeId,
                sss: { enabled: false, frequency: "full" },
                pagibig: { enabled: false, frequency: "full" },
                philhealth: { enabled: false, frequency: "full" },
                tax: { enabled: true, frequency: "full" },
              },
            ],
        incentives:
          options?.runIncentives !== undefined
            ? [{ employeeId, incentives: options.runIncentives }]
            : undefined,
        payslipOverrides: [
          {
            employeeId,
            deductions: [
              { name: "Cash advance", amount: 750, type: "custom" },
              {
                name: "Withholding Tax",
                amount: 9_999,
                type: "government",
              },
            ],
            incentives: incentiveOverride,
            nonTaxableAllowance: 200,
            ...(variableEarningsOverride
              ? { variableEarnings: variableEarningsOverride }
              : {}),
          },
        ],
      }),
      createdAt: 1,
      updatedAt: 2,
    });
    const payslipId = await ctx.db.insert("payslips", {
      organizationId,
      employeeId,
      payrollRunId,
      period: "08/01/2026 to 08/15/2026",
      periodStart: cutoffStart,
      periodEnd: cutoffEnd,
      grossPay: 50_000,
      basicPay: 50_000,
      deductions: [
        { name: "Cash advance", amount: 750, type: "custom" },
        { name: "Withholding Tax", amount: 9_999, type: "government" },
      ],
      incentives: [
        { name: "Project bonus", amount: 1_000, type: "incentive" },
      ],
      nonTaxableAllowance: 200,
      netPay: 40_451,
      daysWorked: 10,
      absences: 0,
      lateHours: 0,
      undertimeHours: 0,
      overtimeHours: 0,
      overtimeRegular: 500,
      concernSummary: { messageCount: 0 },
      createdAt: 1,
    });

    return { organizationId, employeeId, payrollRunId, payslipId };
  });

  return { t, actor: t.withIdentity({ email }), ...fixture };
}

async function readRegeneratedState(
  setup: Awaited<ReturnType<typeof setupOutdatedDraftWithOverrides>>,
) {
  return setup.t.run(async (ctx) => {
    const run = await ctx.db.get(setup.payrollRunId);
    const rawPayslip = await ctx.db
      .query("payslips")
      .withIndex("by_payroll_run", (query) =>
        query.eq("payrollRunId", setup.payrollRunId),
      )
      .unique();
    if (!run || !rawPayslip) throw new Error("Regenerated fixture missing");
    const payslip = decryptPayslipRowFromDb(rawPayslip);
    if (!payslip) throw new Error("Regenerated payslip could not be decrypted");
    return {
      config: decryptDraftConfigFromDb(
        run.draftConfig,
      ) as RegenerationDraftConfig,
      payslip,
    };
  });
}

function findLine(lines: PayrollLine[] | undefined, name: string) {
  return lines?.find(
    (line) => line.name.trim().toLowerCase() === name.toLowerCase(),
  );
}

describe("outdated payroll regeneration behavior", () => {
  it("encrypts the regenerated summary snapshot at rest", async () => {
    vi.stubEnv("ENCRYPTION_KEY", "0123456789abcdef0123456789abcdef");
    const setup = await setupOutdatedDraftWithOverrides();

    await setup.actor.mutation(api.payroll.updatePayrollRun, {
      payrollRunId: setup.payrollRunId,
      preserveExistingPayslipEdits: true,
    });

    const run = await setup.t.run((ctx) => ctx.db.get(setup.payrollRunId));
    expect(run?.summarySnapshot).toMatch(/^pp:enc:v1:/);
    expect(run?.summarySnapshot).not.toContain("regina.pay@example.com");
  });

  it("stores posted payslip correction finances only in an encrypted revision", async () => {
    vi.stubEnv("ENCRYPTION_KEY", "0123456789abcdef0123456789abcdef");
    const setup = await setupOutdatedDraftWithOverrides({
      variableEarningsOverride: null,
    });
    await setup.t.run((ctx) =>
      ctx.db.patch(setup.payrollRunId, {
        status: "finalized",
        finalizedAt: 10,
      }),
    );

    await setup.actor.mutation(api.payroll.updatePayslip, {
      payslipId: setup.payslipId,
      correctionReason: "Approved taxable bonus correction",
      incentives: [
        { name: "Project bonus", amount: 2_000, type: "incentive" },
      ],
    });

    const correction = await setup.t.run((ctx) =>
      ctx.db
        .query("payslipCorrections")
        .withIndex("by_payslip", (query) =>
          query.eq("payslipId", setup.payslipId),
        )
        .unique(),
    );
    expect(correction).toMatchObject({
      revision: 1,
      runStatusAtCorrection: "finalized",
      accountingStatus: "posted",
    });
    expect(correction?.financialSnapshot).toMatch(/^pp:enc:v1:/);
    expect(correction?.reason).toMatch(/^pp:enc:v1:/);
    expect(correction?.reason).not.toContain("Approved taxable bonus correction");
    expect(correction?.oldNetPay).toBeUndefined();
    expect(correction?.newNetPay).toBeUndefined();
    expect(correction?.deltaNetPay).toBeUndefined();

    const visible = await setup.actor.query(
      api.payroll.getUnnotifiedPayslipCorrectionsForRun,
      { payrollRunId: setup.payrollRunId },
    );
    expect(visible.corrections[0]?.reason).toBe(
      "Approved taxable bonus correction",
    );
  });

  it("recalculates withholding after an incentive-only payslip edit", async () => {
    const setup = await setupOutdatedDraftWithOverrides({
      variableEarningsOverride: null,
    });

    await setup.actor.mutation(api.payroll.updatePayslip, {
      payslipId: setup.payslipId,
      incentives: [
        { name: "Project bonus", amount: 2_000, type: "incentive" },
      ],
    });

    const state = await readRegeneratedState(setup);
    expect(state.payslip.grossPay).toBe(51_000);
    expect(findLine(state.payslip.deductions, "Withholding Tax")?.amount).toBe(
      8_131.25,
    );
    expect(state.payslip.netPay).toBe(42_318.75);
  });

  it("defaults missing employee tax settings to enabled during payslip edits", async () => {
    const setup = await setupOutdatedDraftWithOverrides({
      variableEarningsOverride: null,
      omitGovernmentSettings: true,
    });

    await setup.actor.mutation(api.payroll.updatePayslip, {
      payslipId: setup.payslipId,
      incentives: [
        { name: "Project bonus", amount: 2_000, type: "incentive" },
      ],
    });

    const state = await readRegeneratedState(setup);
    expect(findLine(state.payslip.deductions, "Withholding Tax")?.amount).toBe(
      8_131.25,
    );
  });

  it("keeps manual edits but always recalculates withholding tax", async () => {
    const setup = await setupOutdatedDraftWithOverrides();

    const regeneration = await setup.actor.mutation(
      api.payroll.updatePayrollRun,
      {
        payrollRunId: setup.payrollRunId,
        preserveExistingPayslipEdits: true,
      },
    );

    expect(regeneration.regenerationSummary).toMatchObject({
      mode: "preserve_edits",
      employeesProcessed: 1,
      manualOverridesPreserved: 4,
      staleReasons: ["missing_snapshot"],
    });

    const state = await readRegeneratedState(setup);
    expect(findLine(state.payslip.deductions, "Cash advance")?.amount).toBe(750);
    expect(findLine(state.payslip.deductions, "Withholding Tax")?.amount).toBe(
      8_256.25,
    );
    expect(findLine(state.payslip.incentives, "Project bonus")?.amount).toBe(
      1_000,
    );
    expect(state.payslip.nonTaxableAllowance).toBe(200);
    expect(state.payslip.overtimeRegular).toBe(500);
    expect(state.config.payslipOverrides?.[0].deductions).toEqual([
      { name: "Cash advance", amount: 750, type: "custom" },
    ]);
    expect(state.config.overrideReview?.status).toBe("needs_review");

    await setup.actor.mutation(
      api.payroll.markPayrollRunOverrideReviewComplete,
      { payrollRunId: setup.payrollRunId },
    );
    const reviewed = await readRegeneratedState(setup);
    expect(reviewed.config.overrideReview?.status).toBe("reviewed");
  });

  it("synchronizes statutory withholding again before finalization", async () => {
    const setup = await setupOutdatedDraftWithOverrides();
    await setup.actor.mutation(api.payroll.updatePayrollRun, {
      payrollRunId: setup.payrollRunId,
      preserveExistingPayslipEdits: true,
    });
    await setup.actor.mutation(
      api.payroll.markPayrollRunOverrideReviewComplete,
      { payrollRunId: setup.payrollRunId },
    );
    await setup.t.run(async (ctx) => {
      const rawPayslip = await ctx.db
        .query("payslips")
        .withIndex("by_payroll_run", (query) =>
          query.eq("payrollRunId", setup.payrollRunId),
        )
        .unique();
      if (!rawPayslip) throw new Error("Payslip missing");
      await ctx.db.patch(rawPayslip._id, {
        deductions: [
          { name: "Cash advance", amount: 750, type: "custom" },
          { name: "Withholding Tax", amount: 9_999, type: "government" },
        ],
      });
    });

    await setup.actor.mutation(api.payroll.updatePayrollRunStatus, {
      payrollRunId: setup.payrollRunId,
      status: "finalized",
    });

    const state = await readRegeneratedState(setup);
    expect(findLine(state.payslip.deductions, "Withholding Tax")?.amount).toBe(
      8_256.25,
    );
    const run = await setup.t.run((ctx) => ctx.db.get(setup.payrollRunId));
    expect(run?.statutoryRuleVersion).toBe("ph-2025-01");
    expect(JSON.parse(run?.statutoryCheck ?? "{}")).toMatchObject({
      status: "passed",
      ruleVersion: "ph-2025-01",
      withholdingTaxRecalculatedCount: 1,
    });
  });

  it("ignores all per-payslip edits and clears their review state", async () => {
    const setup = await setupOutdatedDraftWithOverrides();

    const regeneration = await setup.actor.mutation(
      api.payroll.updatePayrollRun,
      {
        payrollRunId: setup.payrollRunId,
        preserveExistingPayslipEdits: false,
      },
    );

    expect(regeneration.regenerationSummary).toMatchObject({
      mode: "clean_rebuild",
      employeesProcessed: 1,
      manualOverridesPreserved: 0,
      staleReasons: ["missing_snapshot"],
    });

    const state = await readRegeneratedState(setup);
    expect(findLine(state.payslip.deductions, "Cash advance")).toBeUndefined();
    expect(findLine(state.payslip.deductions, "Withholding Tax")?.amount).toBe(
      7_881.25,
    );
    expect(findLine(state.payslip.incentives, "Project bonus")).toBeUndefined();
    expect(state.payslip.nonTaxableAllowance).toBeUndefined();
    expect(state.payslip.overtimeRegular).toBeUndefined();
    expect(state.config.payslipOverrides).toBeUndefined();
    expect(state.config.overrideReview).toBeUndefined();
  });

  it("recalculates withholding when only a taxable addition is kept", async () => {
    const setup = await setupOutdatedDraftWithOverrides({
      variableEarningsOverride: null,
    });

    await setup.actor.mutation(api.payroll.updatePayrollRun, {
      payrollRunId: setup.payrollRunId,
      preserveExistingPayslipEdits: true,
    });

    const state = await readRegeneratedState(setup);
    expect(findLine(state.payslip.incentives, "Project bonus")?.amount).toBe(
      1_000,
    );
    expect(findLine(state.payslip.deductions, "Withholding Tax")?.amount).toBe(
      8_131.25,
    );
  });

  it("keeps an explicit removal of all run-level additions", async () => {
    const projectBonus = {
      name: "Project bonus",
      amount: 1_000,
      type: "incentive",
    };
    const setup = await setupOutdatedDraftWithOverrides({
      incentiveOverride: [],
      runIncentives: [projectBonus],
      variableEarningsOverride: null,
    });

    await setup.actor.mutation(api.payroll.updatePayrollRun, {
      payrollRunId: setup.payrollRunId,
      preserveExistingPayslipEdits: true,
    });

    const state = await readRegeneratedState(setup);
    expect(findLine(state.payslip.incentives, "Project bonus")).toBeUndefined();
    expect(state.config.payslipOverrides?.[0]).toMatchObject({ incentives: [] });
    expect(state.config.overrideReview?.employees[0].fields).toContain(
      "additions",
    );
  });
});
