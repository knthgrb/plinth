import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("attendance and department flexibility settings", () => {
  it("models configurable attendance policy controls", () => {
    const schemaSource = readSource("../convex/schema.ts");
    const settingsSource = readSource("../convex/settings.ts");
    const attendanceSettingsSource = readSource(
      "../components/settings/attendance-shifts-settings-content.tsx",
    );

    for (const field of [
      "graceMinutes",
      "roundingRule",
      "flexibleShiftsEnabled",
      "overnightShiftCutoffHour",
      "restDayPolicy",
      "geofencePolicy",
      "importPolicy",
      "payrollLockPolicy",
    ]) {
      expect(schemaSource).toContain(field);
      expect(settingsSource).toContain(field);
    }

    expect(attendanceSettingsSource).toContain("Grace minutes");
    expect(attendanceSettingsSource).toContain("Rounding rule");
    expect(attendanceSettingsSource).toContain("Flexible shifts");
    expect(attendanceSettingsSource).toContain("Overnight cutoff");
    expect(attendanceSettingsSource).toContain("Geofence");
    expect(attendanceSettingsSource).toContain("Payroll lock");
  });

  it("models department ownership, cost centers, locations, and reporting lines", () => {
    const schemaSource = readSource("../convex/schema.ts");
    const settingsSource = readSource("../convex/settings.ts");
    const departmentsSettingsSource = readSource(
      "../components/settings/departments-settings-content.tsx",
    );
    const settingsServiceSource = readSource("../services/settings-service.ts");

    for (const field of [
      "departmentHeadUserId",
      "costCenter",
      "location",
      "parentDepartmentName",
    ]) {
      expect(schemaSource).toContain(field);
      expect(settingsSource).toContain(field);
      expect(settingsServiceSource).toContain(field);
    }

    expect(departmentsSettingsSource).toContain("Department head");
    expect(departmentsSettingsSource).toContain("Cost center");
    expect(departmentsSettingsSource).toContain("Location");
    expect(departmentsSettingsSource).toContain("Reporting line");
  });
});
