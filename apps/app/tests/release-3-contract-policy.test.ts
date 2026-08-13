import { describe, expect, it } from "vitest";
import { FULL_SCHEMA_FIELD_OVERRIDES } from "../convex/fullSchemaInventory";
import {
  RELEASE_3_CONTRACT_KEY,
  RELEASE_3_CONTRACT_VERSION,
  RELEASE_3_REMOVALS,
  resolveRelease3ProgramReadiness,
} from "../convex/release3Contract";

describe("release 3 contract policy", () => {
  it("requires clean domain and cleanup evidence before the physical contract", () => {
    expect(
      resolveRelease3ProgramReadiness({
        domainsReady: true,
        compatibilitySwitched: true,
        cleanupAuditReady: false,
      }),
    ).toEqual({
      readyForRelease3B: false,
      blockers: ["RELEASE_3_CONTRACT_AUDIT_NOT_READY"],
    });

    expect(
      resolveRelease3ProgramReadiness({
        domainsReady: true,
        compatibilitySwitched: true,
        cleanupAuditReady: true,
      }),
    ).toEqual({ readyForRelease3B: true, blockers: [] });
  });

  it("reports every independent fail-closed prerequisite", () => {
    expect(
      resolveRelease3ProgramReadiness({
        domainsReady: false,
        compatibilitySwitched: false,
        cleanupAuditReady: false,
      }),
    ).toEqual({
      readyForRelease3B: false,
      blockers: [
        "ADDITIVE_MIGRATIONS_NOT_READY",
        "COMPATIBILITY_SWITCH_NOT_READY",
        "RELEASE_3_CONTRACT_AUDIT_NOT_READY",
      ],
    });
  });

  it("enumerates every removable compatibility projection and preserves history", () => {
    const expectedRemovals = FULL_SCHEMA_FIELD_OVERRIDES.filter(
      ({ table, field, classification }) =>
        (classification === "compatibility_read" ||
          classification === "compatibility_write" ||
          classification === "removable") &&
        !(table === "attendance" && field === "status"),
    ).map(({ table, field }) => `${table}.${field}`);
    const removals = RELEASE_3_REMOVALS.map(
      ({ table, field }) => `${table}.${field}`,
    );

    expect(new Set(removals).size).toBe(removals.length);
    expect(removals.sort()).toEqual(expectedRemovals.sort());
    expect(removals).toContain("invitations.token");
    expect(removals).toContain("employees.payslipPinHash");
    expect(removals).toContain("messages.readBy");
    expect(removals).not.toContain("payslips.employeeSnapshot");
    expect(removals).not.toContain("payrollRuns.summarySnapshot");
  });

  it("uses a stable contract identity", () => {
    expect(RELEASE_3_CONTRACT_KEY).toBe("full-schema-release-3-contract");
    expect(RELEASE_3_CONTRACT_VERSION).toBe(1);
  });
});
