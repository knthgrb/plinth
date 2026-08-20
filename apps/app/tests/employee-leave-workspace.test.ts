import { describe, expect, it } from "vitest";
import {
  buildEmployeeLeaveDashboardModel,
  applyLeavePreview,
  buildLeaveDraftFingerprint,
  canSubmitLeaveDraft,
  createLeaveRequestDraft,
  type EmployeeLeaveDashboardData,
  type EmployeeLeaveRequestSummary,
  getAllowedDurationModes,
  getEmployeePolicyLabel,
  getEmployeeRequestAction,
  setLeaveDraftBenefitEvent,
  setLeaveDraftField,
  type LeaveRequestPreview,
} from "../lib/leave/employee-workspace";

const NOW = Date.parse("2026-08-15T00:00:00+08:00");

const dashboard: EmployeeLeaveDashboardData = {
  employee: {
    employeeId: "employee-1",
    displayName: "Juan Dela Cruz",
    employmentStatus: "active",
  },
  year: 2026,
  balances: [
    {
      balanceId: "balance-company",
      policyId: "policy-company",
      leaveTypeKey: "annual-sil",
      granted: 10,
      used: 2,
      reserved: 1.5,
      available: 6.5,
    },
    {
      balanceId: "balance-statutory",
      policyId: "policy-statutory",
      leaveTypeKey: "vawc",
      granted: 10,
      used: 0,
      reserved: 0,
      available: 10,
    },
  ],
  policies: [
    {
      policyId: "policy-company",
      name: "Annual SIL",
      category: "company",
      confidentiality: "standard",
    },
    {
      policyId: "policy-statutory",
      name: "VAWC Leave",
      category: "statutory",
      confidentiality: "restricted",
    },
  ],
  pendingRequestCount: 1,
};

const requests: EmployeeLeaveRequestSummary[] = [
  {
    id: "recent-pending",
    policyId: "policy-company",
    status: "pending",
    startDate: Date.parse("2026-08-20T00:00:00+08:00"),
    endDate: Date.parse("2026-08-20T00:00:00+08:00"),
    filedDate: Date.parse("2026-08-14T09:00:00+08:00"),
    chargeableDuration: 1,
  },
  {
    id: "approved-upcoming",
    policyId: "policy-company",
    status: "approved",
    startDate: Date.parse("2026-09-01T00:00:00+08:00"),
    endDate: Date.parse("2026-09-02T00:00:00+08:00"),
    filedDate: Date.parse("2026-08-10T09:00:00+08:00"),
    chargeableDuration: 2,
  },
  {
    id: "restricted-history",
    policyId: "policy-statutory",
    status: "approved",
    startDate: Date.parse("2026-07-01T00:00:00+08:00"),
    endDate: Date.parse("2026-07-01T00:00:00+08:00"),
    filedDate: Date.parse("2026-06-28T09:00:00+08:00"),
    chargeableDuration: 1,
  },
];

describe("employee leave dashboard", () => {
  it("presents available, reserved, projected, statutory, upcoming, and recent sections", () => {
    const model = buildEmployeeLeaveDashboardModel({
      dashboard,
      requests,
      now: NOW,
    });

    expect(model.companyBalances).toEqual([
      expect.objectContaining({
        label: "Annual SIL",
        available: 6.5,
        reserved: 1.5,
        projected: 6.5,
      }),
    ]);
    expect(model.statutoryPolicies).toEqual([
      expect.objectContaining({ label: "Protected leave", available: 10 }),
    ]);
    expect(model.upcoming.map((request) => request.id)).toEqual([
      "approved-upcoming",
    ]);
    expect(model.recent.map((request) => request.id)).toEqual([
      "recent-pending",
      "approved-upcoming",
      "restricted-history",
    ]);
    expect(model.recent.at(-1)?.policyLabel).toBe("Protected leave");
  });
});

describe("guided leave request state", () => {
  const preview: LeaveRequestPreview = {
    policy: {
      policyId: "policy-company",
      policyVersionId: "version-1",
      name: "Annual SIL",
      payTreatment: "company_paid",
    },
    requestedStart: Date.parse("2026-08-20T00:00:00+08:00"),
    requestedEnd: Date.parse("2026-08-20T00:00:00+08:00"),
    chargeableDuration: 0.5,
    availableBalance: 6.5,
    remainingBalance: 6,
    requiredDocuments: ["medical_certificate"],
    occurrences: [
      {
        localDate: "2026-08-20",
        scheduledMinutes: 480,
        leaveMinutes: 240,
        creditAmount: 0.5,
        isHoliday: true,
        isRestDay: false,
      },
    ],
  };

  it("uses pay treatment and schedule details only from the latest server preview", () => {
    let draft = createLeaveRequestDraft({
      policyId: "policy-company",
      startLocalDate: "2026-08-20",
      endLocalDate: "2026-08-20",
      allowHalfDay: true,
    });
    const fingerprint = buildLeaveDraftFingerprint(draft);

    draft = applyLeavePreview(draft, preview, fingerprint);

    expect(draft.preview?.policy.payTreatment).toBe("company_paid");
    expect(draft.preview?.occurrences).toEqual(preview.occurrences);
    expect(draft.previewFingerprint).toBe(fingerprint);

    const changed = setLeaveDraftField(draft, "endLocalDate", "2026-08-21");
    expect(changed.preview).toBeNull();
    expect(changed.previewFingerprint).toBeNull();
  });

  it("offers half-day only when the organization configuration permits it", () => {
    expect(getAllowedDurationModes({ allowHalfDay: false, allowHourly: false })).toEqual([
      "day",
    ]);
    expect(getAllowedDurationModes({ allowHalfDay: true, allowHourly: false })).toEqual([
      "day",
      "half_day",
    ]);
  });

  it("blocks submission until the matching preview, reason, and required evidence are present", () => {
    const base = createLeaveRequestDraft({
      policyId: "policy-company",
      startLocalDate: "2026-08-20",
      endLocalDate: "2026-08-20",
      allowHalfDay: true,
    });
    const previewed = applyLeavePreview(
      base,
      preview,
      buildLeaveDraftFingerprint(base),
    );
    const withReason = setLeaveDraftField(previewed, "reason", "Medical rest");

    expect(canSubmitLeaveDraft(withReason)).toBe(false);
    expect(
      canSubmitLeaveDraft({
        ...withReason,
        attachments: [
          {
            storageObjectId: "storage-object-1",
            documentType: "medical_certificate",
            fileName: "certificate.pdf",
          },
        ],
      }),
    ).toBe(true);
  });

  it("uses a neutral employee-facing label for restricted policies", () => {
    expect(
      getEmployeePolicyLabel({
        name: "VAWC Leave",
        confidentiality: "restricted",
      }),
    ).toBe("Protected leave");
  });

  it("requires a qualifying event in event-based request drafts and fingerprints it", () => {
    const base = createLeaveRequestDraft({
      policyId: "policy-maternity",
      startLocalDate: "2026-10-01",
      endLocalDate: "2027-01-13",
      qualifyingEventRequired: true,
    });
    const withEvent = setLeaveDraftBenefitEvent(base, {
      eventType: "maternity",
      qualifyingLocalDate: "2026-10-01",
      benefitVariant: "live_birth",
    });
    const maternityPreview: LeaveRequestPreview = {
      ...preview,
      chargeableDuration: 105,
      availableBalance: null,
      remainingBalance: null,
      requiredDocuments: [],
    };
    const previewed = applyLeavePreview(
      withEvent,
      maternityPreview,
      buildLeaveDraftFingerprint(withEvent),
    );
    const ready = setLeaveDraftField(
      previewed,
      "reason",
      "Maternity leave",
    );

    expect(buildLeaveDraftFingerprint(base)).not.toBe(
      buildLeaveDraftFingerprint(withEvent),
    );
    expect(canSubmitLeaveDraft({ ...ready, benefitEventDraft: undefined })).toBe(
      false,
    );
    expect(canSubmitLeaveDraft(ready)).toBe(true);
  });
});

describe("employee request actions", () => {
  it("allows withdrawal, future cancellation requests, and read-only locked or past records", () => {
    expect(
      getEmployeeRequestAction({ status: "pending", endDate: NOW + 1_000 }, NOW),
    ).toBe("withdraw");
    expect(
      getEmployeeRequestAction(
        { status: "approved", endDate: NOW + 86_400_000 },
        NOW,
      ),
    ).toBe("request_cancellation");
    expect(
      getEmployeeRequestAction(
        { status: "approved", endDate: NOW - 86_400_000 },
        NOW,
      ),
    ).toBe("read_only");
    expect(
      getEmployeeRequestAction(
        { status: "approved", endDate: NOW + 86_400_000, isLocked: true },
        NOW,
      ),
    ).toBe("read_only");
  });
});
