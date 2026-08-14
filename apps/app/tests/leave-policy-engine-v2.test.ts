import { describe, expect, it } from "vitest";
import {
  calculateEntitlement,
  projectLeaveBalance,
  roundLeaveUnits,
  validatePolicyRules,
} from "@/lib/leave/policy-engine";
import type { LeavePolicyRules } from "@/lib/leave/types";

const MANILA_OFFSET_MILLISECONDS = 8 * 60 * 60 * 1000;

function manilaMidnight(year: number, monthIndex: number, day: number): number {
  return Date.UTC(year, monthIndex, day) - MANILA_OFFSET_MILLISECONDS;
}

const privateSil: LeavePolicyRules = {
  accountBehavior: "shared_pool",
  poolKey: "company_leave",
  payTreatment: "company_paid",
  durationBasis: "scheduled_work",
  entitlementMethod: "annual",
  annualUnits: 5,
  eligibility: { basis: "hire_date", completedServiceMonths: 12 },
  prorationMethod: "none",
  roundingIncrement: 0.5,
  carryover: { mode: "unlimited" },
  conversion: { allowed: true },
};

describe("leave policy engine v2", () => {
  it("grants private SIL only after twelve completed service months", () => {
    const periodStart = Date.UTC(2026, 0, 1);
    const periodEnd = Date.UTC(2026, 11, 31);

    expect(
      calculateEntitlement({
        rules: privateSil,
        hireDate: Date.UTC(2025, 8, 1),
        periodStart,
        periodEnd,
        asOf: Date.UTC(2026, 7, 31),
      }),
    ).toBe(0);
    expect(
      calculateEntitlement({
        rules: privateSil,
        hireDate: Date.UTC(2025, 7, 1),
        periodStart,
        periodEnd,
        asOf: Date.UTC(2026, 7, 31),
      }),
    ).toBe(5);
  });

  it("projects reservations without recording usage", () => {
    expect(
      projectLeaveBalance([
        { kind: "grant", amount: 8 },
        { kind: "reservation", amount: -2 },
        { kind: "usage", amount: -1 },
      ]),
    ).toMatchObject({ granted: 8, reserved: 2, used: 1, available: 5 });
  });

  it("reduces used units when a positive restoration is posted", () => {
    expect(
      projectLeaveBalance([
        { kind: "grant", amount: 5 },
        { kind: "usage", amount: -3 },
        { kind: "restoration", amount: 2 },
      ]),
    ).toMatchObject({ granted: 5, used: 1, available: 4 });
  });

  it("rejects a pooled policy without a pool key", () => {
    expect(() =>
      validatePolicyRules({ ...privateSil, poolKey: undefined }),
    ).toThrow("pool key");
  });

  it("prorates annual units by calendar months", () => {
    expect(
      calculateEntitlement({
        rules: {
          ...privateSil,
          eligibility: { basis: "hire_date", completedServiceMonths: 0 },
          annualUnits: 12,
          prorationMethod: "calendar_months",
          roundingIncrement: 1,
        },
        hireDate: Date.UTC(2026, 6, 20),
        periodStart: Date.UTC(2026, 0, 1),
        periodEnd: Date.UTC(2026, 11, 31),
        asOf: Date.UTC(2026, 6, 20),
      }),
    ).toBe(6);
  });

  it("uses Manila-local January 1 and December 31 for calendar-month proration", () => {
    expect(
      calculateEntitlement({
        rules: {
          ...privateSil,
          eligibility: { basis: "hire_date", completedServiceMonths: 0 },
          annualUnits: 12,
          prorationMethod: "calendar_months",
          roundingIncrement: 1,
        },
        hireDate: manilaMidnight(2026, 0, 1),
        periodStart: manilaMidnight(2026, 0, 1),
        periodEnd: manilaMidnight(2026, 11, 31),
        asOf: manilaMidnight(2026, 0, 1),
      }),
    ).toBe(12);
  });

  it("prorates annual units by actual days", () => {
    expect(
      calculateEntitlement({
        rules: {
          ...privateSil,
          eligibility: { basis: "hire_date", completedServiceMonths: 0 },
          annualUnits: 365,
          prorationMethod: "actual_days",
          roundingIncrement: 1,
        },
        hireDate: Date.UTC(2026, 6, 2),
        periodStart: Date.UTC(2026, 0, 1),
        periodEnd: Date.UTC(2026, 11, 31),
        asOf: Date.UTC(2026, 6, 2),
      }),
    ).toBe(183);
  });

  it("uses Manila-local January 1 and December 31 for actual-day proration", () => {
    expect(
      calculateEntitlement({
        rules: {
          ...privateSil,
          eligibility: { basis: "hire_date", completedServiceMonths: 0 },
          annualUnits: 366,
          prorationMethod: "actual_days",
          roundingIncrement: 1,
        },
        hireDate: manilaMidnight(2024, 0, 1),
        periodStart: manilaMidnight(2024, 0, 1),
        periodEnd: manilaMidnight(2024, 11, 31),
        asOf: manilaMidnight(2024, 0, 1),
      }),
    ).toBe(366);
  });

  it("uses the fifteenth-day rule for legacy proration", () => {
    const rules: LeavePolicyRules = {
      ...privateSil,
      eligibility: { basis: "hire_date", completedServiceMonths: 0 },
      annualUnits: 12,
      prorationMethod: "legacy_15th_day",
      roundingIncrement: 1,
    };

    expect(
      calculateEntitlement({
        rules,
        hireDate: Date.UTC(2026, 6, 15),
        periodStart: Date.UTC(2026, 0, 1),
        periodEnd: Date.UTC(2026, 11, 31),
        asOf: Date.UTC(2026, 6, 15),
      }),
    ).toBe(6);
    expect(
      calculateEntitlement({
        rules,
        hireDate: Date.UTC(2026, 6, 16),
        periodStart: Date.UTC(2026, 0, 1),
        periodEnd: Date.UTC(2026, 11, 31),
        asOf: Date.UTC(2026, 6, 16),
      }),
    ).toBe(5);
  });

  it("uses the Manila-local day when applying the legacy fifteenth-day rule", () => {
    expect(
      calculateEntitlement({
        rules: {
          ...privateSil,
          eligibility: { basis: "hire_date", completedServiceMonths: 0 },
          annualUnits: 12,
          prorationMethod: "legacy_15th_day",
          roundingIncrement: 1,
        },
        hireDate: manilaMidnight(2026, 6, 16),
        periodStart: manilaMidnight(2026, 0, 1),
        periodEnd: manilaMidnight(2026, 11, 31),
        asOf: manilaMidnight(2026, 6, 16),
      }),
    ).toBe(5);
  });

  it("starts calendar-month proration after completed service months", () => {
    expect(
      calculateEntitlement({
        rules: {
          ...privateSil,
          eligibility: { basis: "hire_date", completedServiceMonths: 3 },
          annualUnits: 12,
          prorationMethod: "calendar_months",
          roundingIncrement: 1,
        },
        hireDate: manilaMidnight(2026, 2, 10),
        periodStart: manilaMidnight(2026, 0, 1),
        periodEnd: manilaMidnight(2026, 11, 31),
        asOf: manilaMidnight(2026, 5, 10),
      }),
    ).toBe(7);
  });

  it("starts actual-day proration after completed service months", () => {
    expect(
      calculateEntitlement({
        rules: {
          ...privateSil,
          eligibility: { basis: "hire_date", completedServiceMonths: 3 },
          annualUnits: 365,
          prorationMethod: "actual_days",
          roundingIncrement: 1,
        },
        hireDate: manilaMidnight(2026, 2, 10),
        periodStart: manilaMidnight(2026, 0, 1),
        periodEnd: manilaMidnight(2026, 11, 31),
        asOf: manilaMidnight(2026, 5, 10),
      }),
    ).toBe(205);
  });

  it("starts legacy proration after completed service months", () => {
    expect(
      calculateEntitlement({
        rules: {
          ...privateSil,
          eligibility: { basis: "hire_date", completedServiceMonths: 3 },
          annualUnits: 12,
          prorationMethod: "legacy_15th_day",
          roundingIncrement: 1,
        },
        hireDate: manilaMidnight(2026, 2, 10),
        periodStart: manilaMidnight(2026, 0, 1),
        periodEnd: manilaMidnight(2026, 11, 31),
        asOf: manilaMidnight(2026, 5, 10),
      }),
    ).toBe(7);
  });

  it("rounds entitlement once at the policy increment", () => {
    expect(roundLeaveUnits(1.26, 0.5)).toBe(1.5);
    expect(roundLeaveUnits(1.12, 0.25)).toBe(1);
  });

  it("keeps conversion and expiration as separate balance totals", () => {
    expect(
      projectLeaveBalance([
        { kind: "grant", amount: 8 },
        { kind: "conversion", amount: -2 },
        { kind: "expiration", amount: -1 },
      ]),
    ).toMatchObject({ converted: 2, expired: 1, available: 5 });
  });

  it("rejects invalid credit and conversion policy values", () => {
    expect(() =>
      validatePolicyRules({ ...privateSil, annualUnits: -1 }),
    ).toThrow("Annual units");
    expect(() =>
      validatePolicyRules({
        ...privateSil,
        carryover: { mode: "capped" },
      }),
    ).toThrow("cap");
    expect(() =>
      validatePolicyRules({
        ...privateSil,
        accountBehavior: "non_credit",
      }),
    ).toThrow("converted");
  });
});
