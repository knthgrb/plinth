import { describe, expect, it } from "vitest";
import {
  buildAdminApprovalQueues,
  buildCalendarRows,
  buildConversionQueueRows,
  buildLedgerRows,
  getAdminLeaveReason,
  getLeaveAdminTabs,
  getLeaveWorkspaceMode,
  normalizeApprovalColumns,
  resolveAuthenticatedReviewer,
  shouldShowEmployeeLeaveWorkspace,
} from "../lib/leave/admin-workspace";

describe("administrative leave workspace", () => {
  it("keeps the legacy workspace available until canonical activation", () => {
    expect(getLeaveWorkspaceMode(false)).toBe("legacy_compatibility");
    expect(getLeaveWorkspaceMode(true)).toBe("canonical");
  });

  it("gives only Owner, Admin, and HR the operational tabs", () => {
    expect(getLeaveAdminTabs("owner")).toEqual([
      "approvals",
      "balances",
      "conversions",
      "calendar",
    ]);
    expect(getLeaveAdminTabs("manager")).toEqual([]);
    expect(getLeaveAdminTabs("employee")).toEqual([]);
  });

  it("shows employee leave content for an owner using employee view", () => {
    expect(
      shouldShowEmployeeLeaveWorkspace({
        role: "owner",
        isEmployeeExperienceUI: true,
      }),
    ).toBe(true);
    expect(
      shouldShowEmployeeLeaveWorkspace({
        role: "owner",
        isEmployeeExperienceUI: false,
      }),
    ).toBe(false);
    expect(
      shouldShowEmployeeLeaveWorkspace({
        role: "manager",
        isEmployeeExperienceUI: false,
      }),
    ).toBe(true);
  });

  it("separates decision, cancellation, evidence, and conflict queues", () => {
    const model = buildAdminApprovalQueues([
      {
        id: "pending",
        status: "pending",
        employeeName: "Alex Santos",
        policyName: "Sick Leave",
        startDate: 1,
        endDate: 2,
        filedDate: 1,
        requiredDocumentCount: 1,
        submittedDocumentCount: 0,
      },
      {
        id: "cancel",
        status: "cancellation_requested",
        employeeName: "Bea Cruz",
        policyName: "Vacation Leave",
        startDate: 3,
        endDate: 4,
        filedDate: 2,
      },
      {
        id: "conflict",
        status: "pending",
        employeeName: "Chris Lim",
        policyName: "Annual SIL",
        startDate: 5,
        endDate: 6,
        filedDate: 3,
        hasConflict: true,
      },
    ]);

    expect(model.pending.map((row) => row.id)).toEqual(["conflict", "pending"]);
    expect(model.cancellations.map((row) => row.id)).toEqual(["cancel"]);
    expect(model.evidence.map((row) => row.id)).toEqual(["pending"]);
    expect(model.conflicts.map((row) => row.id)).toEqual(["conflict"]);
  });

  it("keeps essential review columns visible", () => {
    expect(
      normalizeApprovalColumns([
        { id: "employee", hidden: true },
        { id: "status", hidden: true },
        { id: "reason", hidden: true },
      ]),
    ).toEqual([
      { id: "employee", hidden: false },
      { id: "status", hidden: false },
      { id: "reason", hidden: true },
      { id: "policy", hidden: false },
      { id: "dates", hidden: false },
    ]);
  });

  it("renders reviewer identity from the authenticated snapshot", () => {
    expect(
      resolveAuthenticatedReviewer({
        displayName: "Maria Reyes",
        role: "hr",
      }),
    ).toEqual({ displayName: "Maria Reyes", position: "HR" });
  });

  it("redacts restricted reasons without an active sensitive grant", () => {
    expect(
      getAdminLeaveReason({
        reason: "Protected case details",
        confidentiality: "restricted",
        hasSensitiveAccess: false,
      }),
    ).toBe("Restricted leave details");
    expect(
      getAdminLeaveReason({
        reason: "Protected case details",
        confidentiality: "restricted",
        hasSensitiveAccess: true,
      }),
    ).toBe("Protected case details");
  });

  it("explains ledger entries with units, date, actor, and reason", () => {
    expect(
      buildLedgerRows([
        {
          id: "ledger-1",
          kind: "adjustment",
          amount: 1.5,
          effectiveDate: Date.parse("2026-08-01T00:00:00+08:00"),
          actorName: "Maria Reyes",
          reason: "Correct opening balance",
        },
      ])[0],
    ).toEqual(
      expect.objectContaining({
        kindLabel: "Adjustment",
        unitsLabel: "+1.5 days",
        dateLabel: "Aug 1, 2026",
        actorLabel: "Maria Reyes",
        reasonLabel: "Correct opening balance",
      }),
    );
  });

  it("shows conversion payroll and final-settlement payment state", () => {
    expect(
      buildConversionQueueRows([
        {
          id: "conversion-1",
          employeeName: "Alex Santos",
          policyName: "Annual SIL",
          requestedDays: 2,
          status: "approved",
          paymentStatus: "included",
          settlementContext: "final_settlement",
        },
      ])[0],
    ).toEqual(
      expect.objectContaining({
        workflowLabel: "Approved",
        paymentLabel: "Included in final settlement",
      }),
    );
  });

  it("uses neutral calendar labels and never exposes protected reasons", () => {
    expect(
      buildCalendarRows([
        {
          id: "leave-1",
          employeeName: "Alex Santos",
          policyName: "VAWC Leave",
          confidentiality: "restricted",
          reason: "Protected case details",
          startDate: 1,
          endDate: 2,
          status: "approved",
        },
      ])[0],
    ).toEqual(
      expect.objectContaining({
        availabilityLabel: "Alex Santos is unavailable",
        policyLabel: "Protected leave",
        reason: undefined,
      }),
    );
  });
});
