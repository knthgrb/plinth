import { describe, expect, it } from "vitest";
import {
  defaultDepartmentColor,
  normalizeDepartmentName,
  planOrganizationNormalization,
} from "../convex/databaseMigrationPlanner";
import { RELEASE_1_SCHEMA_FIELD_MANIFEST } from "../convex/schemaFieldManifest";

describe("database migration planner", () => {
  it("keeps active organization payroll cadence and reports a legacy conflict", () => {
    const plan = planOrganizationNormalization({
      organization: {
        firstPayDate: 25,
        secondPayDate: 30,
        salaryPaymentFrequency: "monthly",
        defaultRequirements: [],
      },
      legacySettings: {
        payrollFrequency: "semi-monthly",
        cutoffDates: { firstCutoff: 10, secondCutoff: 25 },
        payrollSettings: { nightDiffPercent: 1.1 },
        attendanceSettings: { graceMinutes: 5 },
      },
    });

    expect(plan.payroll).toEqual({
      salaryPaymentFrequency: "monthly",
      firstPayDate: 25,
      secondPayDate: 30,
      cutoffDates: { firstCutoff: 10, secondCutoff: 25 },
      payrollSettings: { nightDiffPercent: 1.1 },
    });
    expect(plan.attendance).toEqual({ graceMinutes: 5 });
    expect(plan.issues).toContainEqual({
      code: "PAYROLL_FREQUENCY_CONFLICT",
      field: "salaryPaymentFrequency",
    });
  });

  it("does not copy the deprecated plaintext payroll password", () => {
    const plan = planOrganizationNormalization({
      organization: {},
      legacySettings: {
        payrollSettings: {
          nightDiffPercent: 1.1,
          payrollTabPassword: "plaintext-secret",
        },
      },
    });

    expect(plan.payroll.payrollSettings).toEqual({ nightDiffPercent: 1.1 });
    expect(JSON.stringify(plan)).not.toContain("plaintext-secret");
  });

  it("classifies compatibility, historical, and removable schema fields", () => {
    expect(RELEASE_1_SCHEMA_FIELD_MANIFEST).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "organizations",
          field: "salaryPaymentFrequency",
          classification: "compatibility_read",
          target: "organizationPayrollSettings.salaryPaymentFrequency",
        }),
        expect.objectContaining({
          table: "payslips",
          field: "employeeSnapshot",
          classification: "historical_snapshot",
        }),
        expect.objectContaining({
          table: "payrollRuns",
          field: "draftConfig",
          classification: "historical_snapshot",
        }),
        expect.objectContaining({
          table: "payrollRuns",
          field: "summarySnapshot",
          classification: "historical_snapshot",
        }),
        expect.objectContaining({
          table: "settings",
          field: "taxTable",
          classification: "removable",
          releaseGate: "production_count_and_export",
        }),
        expect.objectContaining({
          table: "settings",
          field: "payrollFrequency",
          classification: "removable",
          releaseGate: "production_count_and_export",
        }),
        expect.objectContaining({
          table: "settings",
          field: "payrollSettings.payrollTabPassword",
          classification: "removable",
          releaseGate: "production_count_and_export",
        }),
      ]),
    );
  });

  it("uses stable payroll defaults without inventing issues", () => {
    const plan = planOrganizationNormalization({
      organization: { defaultRequirements: [] },
      legacySettings: null,
    });

    expect(plan.payroll).toEqual({
      salaryPaymentFrequency: "bimonthly",
      firstPayDate: 15,
      secondPayDate: 30,
    });
    expect(plan.attendance).toBeNull();
    expect(plan.issues).toEqual([]);
  });

  it("reports unsupported weekly legacy payroll frequency", () => {
    const plan = planOrganizationNormalization({
      organization: {},
      legacySettings: { payrollFrequency: "weekly" },
    });

    expect(plan.issues).toContainEqual({
      code: "UNSUPPORTED_PAYROLL_FREQUENCY",
      field: "payrollFrequency",
    });
  });

  it("normalizes departments and reports duplicate names without values", () => {
    const plan = planOrganizationNormalization({
      organization: { defaultRequirements: [] },
      legacySettings: {
        departments: [
          " Operations ",
          { name: "operations", color: "#000000", costCenter: "OPS" },
          "People",
        ],
      },
    });

    expect(plan.departments).toEqual([
      {
        name: "Operations",
        normalizedName: "operations",
        color: defaultDepartmentColor(0),
      },
      {
        name: "People",
        normalizedName: "people",
        color: defaultDepartmentColor(2),
      },
    ]);
    expect(normalizeDepartmentName("  People OPS  ")).toBe("people ops");
    expect(plan.issues).toContainEqual({
      code: "DUPLICATE_DEPARTMENT_NAME",
      field: "departments",
    });
    expect(JSON.stringify(plan.issues)).not.toContain("Operations");
  });

  it("copies unique requirement definitions and reports duplicate types", () => {
    const plan = planOrganizationNormalization({
      organization: {
        defaultRequirements: [
          { type: "NBI Clearance", isRequired: true },
          { type: " nbi clearance ", requiresVerification: true },
          { type: "TIN", reminderDaysBeforeDue: 30 },
        ],
      },
      legacySettings: null,
    });

    expect(plan.requirements).toEqual([
      {
        type: "NBI Clearance",
        normalizedType: "nbi clearance",
        isRequired: true,
      },
      {
        type: "TIN",
        normalizedType: "tin",
        reminderDaysBeforeDue: 30,
      },
    ]);
    expect(plan.issues).toContainEqual({
      code: "DUPLICATE_REQUIREMENT_TYPE",
      field: "defaultRequirements",
    });
  });
});
