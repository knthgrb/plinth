import { describe, expect, it } from "vitest";

import type { Id } from "@/convex/_generated/dataModel";
import {
  getPayrollCorrectionRequirement,
  hasIncludedPayrollLockedRows,
} from "@/lib/attendance-import/payroll-correction";

const employeeId = "employee-one" as Id<"employees">;
const otherEmployeeId = "employee-two" as Id<"employees">;
const date = Date.UTC(2026, 6, 10);

describe("attendance import payroll correction visibility", () => {
  it("stays hidden when no selected row is payroll-locked", () => {
    expect(
      hasIncludedPayrollLockedRows(
        [{ employeeId, date, included: true }],
        [],
      ),
    ).toBe(false);
  });

  it("appears when an included row is payroll-locked", () => {
    expect(
      hasIncludedPayrollLockedRows(
        [{ employeeId, date, included: true }],
        [{ employeeId, date }],
      ),
    ).toBe(true);
  });

  it("ignores payroll-locked rows excluded from the import", () => {
    expect(
      hasIncludedPayrollLockedRows(
        [{ employeeId, date, included: false }],
        [{ employeeId, date }],
      ),
    ).toBe(false);
  });

  it("matches the employee as well as the attendance date", () => {
    expect(
      hasIncludedPayrollLockedRows(
        [{ employeeId: otherEmployeeId, date, included: true }],
        [{ employeeId, date }],
      ),
    ).toBe(false);
  });

  it("normalizes timestamps to the same Manila attendance day", () => {
    expect(
      hasIncludedPayrollLockedRows(
        [{ employeeId, date: date + 60 * 60 * 1000, included: true }],
        [{ employeeId, date }],
      ),
    ).toBe(true);
  });

  it("requires a reason only when the member can correct locked rows", () => {
    const rows = [{ employeeId, date, included: true }];
    const lockedEntries = [{ employeeId, date }];

    expect(
      getPayrollCorrectionRequirement(rows, lockedEntries, true),
    ).toBe("reason-required");
    expect(
      getPayrollCorrectionRequirement(rows, lockedEntries, false),
    ).toBe("blocked");
    expect(getPayrollCorrectionRequirement(rows, [], true)).toBe(
      "not-required",
    );
  });
});
