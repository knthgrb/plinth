import { describe, expect, it } from "vitest";

import type { Id } from "@/convex/_generated/dataModel";
import type {
  AttendanceImportEmployee,
  AttendanceImportHoliday,
} from "@/lib/attendance-import/preview";
import {
  attendanceTimeToHHmm,
  applyAttendanceImportConflicts,
  buildAttendanceImportPreview,
  buildAttendanceImportPreviewWhenReady,
  findAttendanceEmployee,
  getAttendanceImportRowIdentities,
  reconcileAttendanceImportPreviewState,
} from "@/lib/attendance-import/preview";
import type { NormalizedAttendanceCandidate } from "@/lib/attendance-import/types";

const organizationId = "org-preview" as Id<"organizations">;

const employeeFixture = {
  _id: "employee-preview" as Id<"employees">,
  _creationTime: 1_754_987_200_000,
  organizationId,
  personalInfo: {
    firstName: "Jane",
    lastName: "Doe",
    email: "jane.doe@example.com",
    province: "Cebu",
  },
  employment: {
    employeeId: "EMP-001",
    position: "Engineer",
    department: "Operations",
    employmentType: "regular",
    hireDate: 1_704_067_200_000,
    status: "active",
  },
  compensation: {
    basicSalary: 50_000,
    allowance: 5_000,
    salaryType: "monthly",
  },
  schedule: {
    defaultSchedule: {
      monday: { in: "08:00", out: "17:00", isWorkday: true },
      tuesday: { in: "09:00", out: "18:00", isWorkday: true },
      wednesday: { in: "10:00", out: "19:00", isWorkday: true },
      thursday: { in: "09:00", out: "18:00", isWorkday: true },
      friday: { in: "09:00", out: "18:00", isWorkday: true },
      saturday: { in: "09:00", out: "18:00", isWorkday: false },
      sunday: { in: "09:00", out: "18:00", isWorkday: false },
    },
  },
  createdAt: 1_704_067_200_000,
  updatedAt: 1_704_067_200_000,
} satisfies AttendanceImportEmployee;

const holidayFixture = {
  _id: "holiday-preview" as Id<"holidays">,
  _creationTime: 1_754_987_200_000,
  organizationId,
  name: "Cebu Foundation Day",
  date: Date.UTC(2026, 7, 17),
  type: "regular",
  isRecurring: false,
  year: 2026,
  applyToAll: false,
  provinces: ["Cebu"],
  createdAt: 1_704_067_200_000,
  updatedAt: 1_704_067_200_000,
} satisfies AttendanceImportHoliday;

const duplicateEmployeeIdFixture = {
  ...employeeFixture,
  _id: "employee-duplicate-id" as Id<"employees">,
} satisfies AttendanceImportEmployee;

const duplicateNameFixture = {
  ...employeeFixture,
  _id: "employee-duplicate-name" as Id<"employees">,
  employment: {
    ...employeeFixture.employment,
    employeeId: "EMP-002",
  },
} satisfies AttendanceImportEmployee;

const crossFieldCollisionEmployee = {
  ...employeeFixture,
  _id: "employee-cross-field" as Id<"employees">,
  personalInfo: {
    ...employeeFixture.personalInfo,
    firstName: "John",
    lastName: "Smith",
  },
  employment: {
    ...employeeFixture.employment,
    employeeId: "Jane Doe",
  },
} satisfies AttendanceImportEmployee;

const invalidScheduleEmployee = {
  ...employeeFixture,
  _id: "employee-invalid-schedule" as Id<"employees">,
  employment: {
    ...employeeFixture.employment,
    employeeId: "EMP-003",
  },
  schedule: {
    defaultSchedule: {
      ...employeeFixture.schedule.defaultSchedule,
      monday: { in: "8:00", out: "17:00", isWorkday: true },
      tuesday: { in: "09:00", out: "", isWorkday: true },
    },
  },
} satisfies AttendanceImportEmployee;

const validCandidate: NormalizedAttendanceCandidate = {
  sourceSheet: "August Attendance",
  sourceRow: 8,
  employeeKey: "EMP-001",
  date: "2026-08-17",
  timeIn: "8:15 AM",
  timeOut: "5:45 PM",
  status: "present",
  notes: "Client visit",
  issues: [],
};

describe("attendance import preview mapping", () => {
  it("waits for both lookup datasets before mapping retained candidates", () => {
    expect(
      buildAttendanceImportPreviewWhenReady(
        [validCandidate],
        undefined,
        [],
      ),
    ).toBeUndefined();
    expect(
      buildAttendanceImportPreviewWhenReady(
        [validCandidate],
        [employeeFixture],
        undefined,
      ),
    ).toBeUndefined();

    const rows = buildAttendanceImportPreviewWhenReady(
      [validCandidate],
      [employeeFixture],
      [],
    );

    expect(rows?.[0]).toMatchObject({
      employeeId: employeeFixture._id,
      error: null,
      includeInImport: true,
    });
  });

  it("clears stale conflict IDs when a loaded conflict query is empty", () => {
    const [row] = buildAttendanceImportPreview(
      [validCandidate],
      [employeeFixture],
      [],
    );
    const staleConflictRow = {
      ...row,
      existingAttendanceId: "attendance-stale" as Id<"attendance">,
    };

    expect(
      applyAttendanceImportConflicts([staleConflictRow], undefined),
    ).toEqual([staleConflictRow]);
    expect(applyAttendanceImportConflicts([staleConflictRow], [])[0])
      .toMatchObject({ existingAttendanceId: null });
  });

  it("preserves explicit exclude, rest-day include, and overwrite decisions across rebuilds", () => {
    const candidates = [
      validCandidate,
      {
        ...validCandidate,
        sourceRow: 9,
        date: "2026-08-15",
      },
      {
        ...validCandidate,
        sourceRow: 10,
        date: "2026-08-18",
      },
    ];
    const updatedEmployee = {
      ...employeeFixture,
      schedule: {
        defaultSchedule: {
          ...employeeFixture.schedule.defaultSchedule,
          monday: { in: "07:00", out: "16:00", isWorkday: true },
        },
      },
    } satisfies AttendanceImportEmployee;
    const rebuilt = applyAttendanceImportConflicts(
      buildAttendanceImportPreview(candidates, [updatedEmployee], []),
      [
        {
          _id: "attendance-overwrite" as Id<"attendance">,
          employeeId: employeeFixture._id,
          date: Date.UTC(2026, 7, 18),
        },
      ],
    );
    const identities = getAttendanceImportRowIdentities(rebuilt);

    const { rows: reconciled } = reconcileAttendanceImportPreviewState(
      rebuilt,
      {
        [identities[0]]: {
          employeeId: employeeFixture._id,
          dateTs: Date.UTC(2026, 7, 17),
          includeInImport: false,
        },
        [identities[1]]: {
          employeeId: employeeFixture._id,
          dateTs: Date.UTC(2026, 7, 15),
          includeInImport: true,
        },
        [identities[2]]: {
          employeeId: employeeFixture._id,
          dateTs: Date.UTC(2026, 7, 18),
          approvedExistingAttendanceId:
            "attendance-overwrite" as Id<"attendance">,
        },
      },
    );

    expect(reconciled[0].includeInImport).toBe(false);
    expect(reconciled[0].scheduleIn).toBe("07:00");
    expect(reconciled[1]).toMatchObject({
      isRestDay: true,
      includeInImport: true,
    });
    expect(reconciled[2]).toMatchObject({
      existingAttendanceId: "attendance-overwrite",
      includeInImport: true,
      overwriteExisting: true,
    });

    const afterConflictRemoval = reconcileAttendanceImportPreviewState(
      applyAttendanceImportConflicts(rebuilt, []),
      {
        [identities[2]]: {
          employeeId: employeeFixture._id,
          dateTs: Date.UTC(2026, 7, 18),
          approvedExistingAttendanceId:
            "attendance-overwrite" as Id<"attendance">,
        },
      },
    );
    expect(afterConflictRemoval.rows[2]).toMatchObject({
      existingAttendanceId: null,
      overwriteExisting: false,
    });
    expect(
      afterConflictRemoval.decisions[identities[2]]
        ?.approvedExistingAttendanceId,
    ).toBeUndefined();

    for (const conflictId of ["attendance-new", "attendance-overwrite"]) {
      const reappeared = reconcileAttendanceImportPreviewState(
        applyAttendanceImportConflicts(rebuilt, [
          {
            _id: conflictId as Id<"attendance">,
            employeeId: employeeFixture._id,
            date: Date.UTC(2026, 7, 18),
          },
        ]),
        afterConflictRemoval.decisions,
      );
      expect(reappeared.rows[2].overwriteExisting).toBe(false);
    }
  });

  it("retains an exact overwrite approval while conflict lookup is pending", () => {
    const [freshRow] = buildAttendanceImportPreview(
      [validCandidate],
      [employeeFixture],
      [],
    );
    const [identity] = getAttendanceImportRowIdentities([freshRow]);
    const existingAttendanceId = "attendance-pending" as Id<"attendance">;
    const pending = reconcileAttendanceImportPreviewState(
      [freshRow],
      {
        [identity]: {
          employeeId: employeeFixture._id,
          dateTs: freshRow.dateTs,
          approvedExistingAttendanceId: existingAttendanceId,
        },
      },
      false,
    );

    expect(pending.rows[0].overwriteExisting).toBe(false);
    expect(
      pending.decisions[identity]?.approvedExistingAttendanceId,
    ).toBe(existingAttendanceId);

    const loaded = reconcileAttendanceImportPreviewState(
      applyAttendanceImportConflicts([freshRow], [
        {
          _id: existingAttendanceId,
          employeeId: employeeFixture._id,
          date: freshRow.dateTs,
        },
      ]),
      pending.decisions,
    );

    expect(loaded.rows[0].overwriteExisting).toBe(true);
  });

  it("never preserves include or overwrite decisions for a rebuilt invalid row", () => {
    const [invalidRow] = applyAttendanceImportConflicts(
      buildAttendanceImportPreview(
        [{ ...validCandidate, employeeKey: "Unknown" }],
        [employeeFixture],
        [],
      ),
      [],
    );
    const [identity] = getAttendanceImportRowIdentities([invalidRow]);

    const invalidState = reconcileAttendanceImportPreviewState([invalidRow], {
      [identity]: {
        employeeId: employeeFixture._id,
        dateTs: Date.UTC(2026, 7, 17),
        includeInImport: true,
        approvedExistingAttendanceId: "attendance-old" as Id<"attendance">,
      },
    });
    const [reconciled] = invalidState.rows;

    expect(reconciled).toMatchObject({
      employeeId: null,
      includeInImport: false,
      existingAttendanceId: null,
      overwriteExisting: false,
    });
    expect(invalidState.decisions[identity]).toBeUndefined();

    const [resolvedAsDifferentEmployee] = buildAttendanceImportPreview(
      [{ ...validCandidate, employeeKey: "EMP-002" }],
      [employeeFixture, duplicateNameFixture],
      [],
    );
    const resolvedState = reconcileAttendanceImportPreviewState(
      [resolvedAsDifferentEmployee],
      invalidState.decisions,
    );

    expect(resolvedState.rows[0].includeInImport).toBe(true);
    expect(resolvedState.decisions[identity]).toBeUndefined();
  });

  it("keeps duplicate source coordinates as distinct decision identities", () => {
    const rows = buildAttendanceImportPreview(
      [validCandidate, { ...validCandidate, date: "2026-08-15" }],
      [employeeFixture],
      [],
    );
    const identities = getAttendanceImportRowIdentities(rows);

    expect(identities[0]).not.toBe(identities[1]);
    const { rows: reconciled } = reconcileAttendanceImportPreviewState(rows, {
      [identities[0]]: {
        employeeId: employeeFixture._id,
        dateTs: Date.UTC(2026, 7, 17),
        includeInImport: false,
      },
      [identities[1]]: {
        employeeId: employeeFixture._id,
        dateTs: Date.UTC(2026, 7, 15),
        includeInImport: true,
      },
    });
    expect(reconciled[0].includeInImport).toBe(false);
    expect(reconciled[1].includeInImport).toBe(true);
  });

  it("does not migrate an include decision when employee or date resolution changes", () => {
    const [original] = buildAttendanceImportPreview(
      [validCandidate],
      [employeeFixture, duplicateNameFixture],
      [],
    );
    const [identity] = getAttendanceImportRowIdentities([original]);
    const decision = {
      [identity]: {
        employeeId: employeeFixture._id,
        dateTs: original.dateTs,
        includeInImport: false,
      },
    };
    const [differentEmployee] = buildAttendanceImportPreview(
      [{ ...validCandidate, employeeKey: "EMP-002" }],
      [employeeFixture, duplicateNameFixture],
      [],
    );
    const employeeChanged = reconcileAttendanceImportPreviewState(
      [differentEmployee],
      decision,
    );

    expect(employeeChanged.rows[0].includeInImport).toBe(true);
    expect(employeeChanged.decisions[identity]).toBeUndefined();

    const [differentDate] = buildAttendanceImportPreview(
      [{ ...validCandidate, date: "2026-08-18" }],
      [employeeFixture],
      [],
    );
    const dateChanged = reconcileAttendanceImportPreviewState(
      [differentDate],
      decision,
    );

    expect(dateChanged.rows[0].includeInImport).toBe(true);
    expect(dateChanged.decisions[identity]).toBeUndefined();
  });

  it("keeps valid rows importable while flagging invalid rows", () => {
    const rows = buildAttendanceImportPreview(
      [validCandidate, { ...validCandidate, employeeKey: "Unknown" }],
      [employeeFixture],
      [],
    );

    expect(rows[0]).toMatchObject({
      employeeId: employeeFixture._id,
      includeInImport: true,
      error: null,
    });
    expect(rows[1]).toMatchObject({
      employeeId: null,
      includeInImport: false,
      error: "Employee not found",
    });
  });

  it("matches normalized employee IDs and both supported name orders", () => {
    expect(
      findAttendanceEmployee("  emp-001 ", [employeeFixture]),
    ).toBe(employeeFixture);
    expect(
      findAttendanceEmployee("  JANE   DOE ", [employeeFixture]),
    ).toBe(employeeFixture);
    expect(
      findAttendanceEmployee("doe, jane", [employeeFixture]),
    ).toBe(employeeFixture);
  });

  it("rejects duplicate normalized employee IDs as ambiguous", () => {
    const employees = [employeeFixture, duplicateEmployeeIdFixture];
    const [row] = buildAttendanceImportPreview(
      [validCandidate],
      employees,
      [],
    );

    expect(findAttendanceEmployee("EMP-001", employees)).toBeNull();
    expect(row).toMatchObject({
      employeeId: null,
      error: "Employee match is ambiguous",
      includeInImport: false,
    });
  });

  it("rejects duplicate normalized names as ambiguous", () => {
    const employees = [employeeFixture, duplicateNameFixture];
    const candidate = { ...validCandidate, employeeKey: "Jane Doe" };
    const [row] = buildAttendanceImportPreview([candidate], employees, []);

    expect(findAttendanceEmployee("jane doe", employees)).toBeNull();
    expect(row).toMatchObject({
      employeeId: null,
      error: "Employee match is ambiguous",
      includeInImport: false,
    });
  });

  it("rejects a key that matches one employee ID and another employee name", () => {
    const employees = [employeeFixture, crossFieldCollisionEmployee];
    const [row] = buildAttendanceImportPreview(
      [{ ...validCandidate, employeeKey: "Jane Doe" }],
      employees,
      [],
    );

    expect(findAttendanceEmployee("Jane Doe", employees)).toBeNull();
    expect(row).toMatchObject({
      employeeId: null,
      error: "Employee match is ambiguous",
      includeInImport: false,
    });
  });

  it("selects the Manila weekday schedule and converts actual times to HH:mm", () => {
    const [row] = buildAttendanceImportPreview(
      [validCandidate],
      [employeeFixture],
      [],
    );

    expect(row).toMatchObject({
      dateTs: Date.UTC(2026, 7, 17),
      sourceDate: "2026-08-17",
      dateLabel: "Aug 17, 2026",
      scheduleIn: "08:00",
      scheduleOut: "17:00",
      actualIn: "08:15",
      actualOut: "17:45",
    });
    expect(attendanceTimeToHHmm("12:05 AM")).toBe("00:05");
    expect(attendanceTimeToHHmm("12:05 PM")).toBe("12:05");
    expect(attendanceTimeToHHmm("invalid")).toBeUndefined();
  });

  it("falls back to default times for missing or non-canonical workday schedules", () => {
    const rows = buildAttendanceImportPreview(
      [
        { ...validCandidate, employeeKey: "EMP-003", date: "2026-08-17" },
        { ...validCandidate, employeeKey: "EMP-003", date: "2026-08-18" },
      ],
      [invalidScheduleEmployee],
      [],
    );

    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ scheduleIn: "09:00", scheduleOut: "18:00" }),
      ]),
    );
    expect(rows[0]).toMatchObject({ scheduleIn: "09:00", scheduleOut: "18:00" });
    expect(rows[1]).toMatchObject({ scheduleIn: "09:00", scheduleOut: "18:00" });
  });

  it("excludes scheduled rest days by default without marking the row invalid", () => {
    const [row] = buildAttendanceImportPreview(
      [{ ...validCandidate, date: "2026-08-22" }],
      [employeeFixture],
      [],
    );

    expect(row).toMatchObject({
      error: null,
      isRestDay: true,
      includeInImport: false,
    });
  });

  it("allows no_work only for an applicable non-working holiday", () => {
    const [allowedRow] = buildAttendanceImportPreview(
      [
        {
          ...validCandidate,
          status: "no_work",
          timeIn: undefined,
          timeOut: undefined,
        },
      ],
      [employeeFixture],
      [holidayFixture],
    );
    const [rejectedRow] = buildAttendanceImportPreview(
      [{ ...validCandidate, status: "no_work", date: "2026-08-18", timeIn: undefined, timeOut: undefined }],
      [employeeFixture],
      [holidayFixture],
    );
    const [specialWorkingRow] = buildAttendanceImportPreview(
      [{ ...validCandidate, status: "no_work", timeIn: undefined, timeOut: undefined }],
      [employeeFixture],
      [{ ...holidayFixture, type: "special_working" }],
    );
    const [provinceRow] = buildAttendanceImportPreview(
      [{ ...validCandidate, status: "no_work", timeIn: undefined, timeOut: undefined }],
      [employeeFixture],
      [{ ...holidayFixture, provinces: ["Davao"] }],
    );

    expect(allowedRow).toMatchObject({ error: null, includeInImport: true });
    expect(rejectedRow).toMatchObject({
      error: "No work is only allowed on holiday dates for this employee",
      includeInImport: false,
    });
    expect(specialWorkingRow).toMatchObject({
      error: "No work is only allowed on holiday dates for this employee",
      includeInImport: false,
    });
    expect(provinceRow).toMatchObject({
      error: "No work is only allowed on holiday dates for this employee",
      includeInImport: false,
    });
  });

  it("allows no_work for an applicable special holiday", () => {
    const [row] = buildAttendanceImportPreview(
      [{ ...validCandidate, status: "no_work", timeIn: undefined, timeOut: undefined }],
      [employeeFixture],
      [{ ...holidayFixture, type: "special" }],
    );

    expect(row).toMatchObject({ error: null, includeInImport: true });
  });

  it("retains invalid source values and combines all issue messages for display", () => {
    const [row] = buildAttendanceImportPreview(
      [
        {
          sourceSheet: "Raw biometric data",
          sourceRow: 42,
          employeeKey: "Unknown Person",
          date: "2026-02-29",
          timeIn: "8:05 AM",
          timeOut: "5:10 PM",
          status: "present",
          notes: "Clock skipped at lunch",
          issues: [
            { code: "invalid_date", message: "Date must be a valid ISO date." },
            { code: "invalid_time", message: "Invalid punch: 8:61 AM." },
            { code: "invalid_status", message: "Unsupported status: remote." },
          ],
        },
      ],
      [employeeFixture],
      [],
    );

    expect(row).toMatchObject({
      sourceSheet: "Raw biometric data",
      sourceRow: 42,
      employeeName: "Unknown Person",
      sourceDate: "2026-02-29",
      dateTs: 0,
      dateLabel: "2026-02-29",
      actualIn: "08:05",
      actualOut: "17:10",
      notes: "Clock skipped at lunch",
      includeInImport: false,
    });
    expect(row.error).toContain("Employee not found");
    expect(row.error).toContain("Date must be a valid ISO date.");
    expect(row.error).toContain("Invalid punch: 8:61 AM.");
    expect(row.error).toContain("Unsupported status: remote.");
  });

  it("retains non-zero-padded invalid ISO dates instead of reformatting them", () => {
    const [row] = buildAttendanceImportPreview(
      [
        {
          ...validCandidate,
          date: "2026-8-7",
          issues: [
            { code: "invalid_date", message: "Date must be a valid ISO date." },
          ],
        },
      ],
      [employeeFixture],
      [],
    );

    expect(row).toMatchObject({
      dateTs: 0,
      dateLabel: "2026-8-7",
      includeInImport: false,
    });
    expect(row.error).toContain("Date must be a valid ISO date.");
  });

  it("excludes missing date or time rows while retaining the status issue", () => {
    const [row] = buildAttendanceImportPreview(
      [
        {
          ...validCandidate,
          date: "",
          timeIn: undefined,
          status: "half-day",
          issues: [
            { code: "invalid_status", message: "Unsupported status: remote." },
          ],
        },
      ],
      [employeeFixture],
      [],
    );

    expect(row).toMatchObject({
      employeeName: "EMP-001",
      dateTs: 0,
      dateLabel: "—",
      actualOut: "17:45",
      includeInImport: false,
    });
    expect(row.error).toContain("Date is required.");
    expect(row.error).toContain("Time In/Out required for half-day");
    expect(row.error).toContain("Unsupported status: remote.");
  });

  it("preserves duplicate candidates as separately reviewable rows", () => {
    const rows = buildAttendanceImportPreview(
      [validCandidate, { ...validCandidate, sourceRow: 9 }],
      [employeeFixture],
      [],
    );

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.sourceRow)).toEqual([8, 9]);
  });
});
