import type { Id } from "@/convex/_generated/dataModel";
import { attendanceDayKey } from "@/lib/manila-date";

export interface AttendancePayrollReviewRow {
  employeeId: Id<"employees">;
  date: number;
  included: boolean;
}

export interface AttendancePayrollLockedEntry {
  employeeId: Id<"employees">;
  date: number;
}

export type PayrollCorrectionRequirement =
  | "not-required"
  | "reason-required"
  | "blocked";

export function hasIncludedPayrollLockedRows(
  rows: AttendancePayrollReviewRow[],
  lockedEntries: AttendancePayrollLockedEntry[],
): boolean {
  const lockedKeys = new Set(
    lockedEntries.map((entry) =>
      attendanceDayKey(entry.employeeId, entry.date),
    ),
  );

  return rows.some(
    (row) =>
      row.included && lockedKeys.has(attendanceDayKey(row.employeeId, row.date)),
  );
}

export function getPayrollCorrectionRequirement(
  rows: AttendancePayrollReviewRow[],
  lockedEntries: AttendancePayrollLockedEntry[],
  canCorrectWithReason: boolean,
): PayrollCorrectionRequirement {
  if (!hasIncludedPayrollLockedRows(rows, lockedEntries)) {
    return "not-required";
  }

  return canCorrectWithReason ? "reason-required" : "blocked";
}
