import { describe, expect, it } from "vitest";
import {
  calculateSubmissionExpiry,
  deriveRequirementState,
  filterApplicableRequirementPolicies,
  isRequirementApplicable,
  summarizeEmployeeRequirements,
  summarizeRequirementWorkspace,
  type RequirementPolicy,
} from "../lib/requirements/workflow";

const DAY = 24 * 60 * 60 * 1_000;
const NOW = Date.UTC(2026, 7, 14);

describe("requirements workflow domain", () => {
  it("matches department and employment type without case or whitespace sensitivity", () => {
    const policy: RequirementPolicy = {
      type: "Professional license",
      appliesToDepartments: [" Engineering "],
      appliesToEmploymentTypes: ["REGULAR"],
    };

    expect(
      isRequirementApplicable(policy, {
        department: "engineering",
        employmentType: " regular ",
      }),
    ).toBe(true);
    expect(
      isRequirementApplicable(policy, {
        department: "Finance",
        employmentType: "regular",
      }),
    ).toBe(false);
  });

  it("treats an empty applicability list as applying to everyone", () => {
    const policies: RequirementPolicy[] = [
      { type: "Government ID", appliesToDepartments: [] },
      { type: "Engineering license", appliesToDepartments: ["Engineering"] },
    ];

    expect(
      filterApplicableRequirementPolicies(policies, {
        department: "People",
        employmentType: "probationary",
      }).map((policy) => policy.type),
    ).toEqual(["Government ID"]);
  });

  it("starts a configured expiry period from submission", () => {
    expect(
      calculateSubmissionExpiry(
        { type: "Clearance", expiryDaysAfterSubmission: 30 },
        NOW,
      ),
    ).toBe(NOW + 30 * DAY);
    expect(calculateSubmissionExpiry({ type: "Diploma" }, NOW)).toBeUndefined();
  });

  it.each([
    {
      name: "required evidence is missing",
      requirement: { type: "ID", status: "pending" as const, isRequired: true },
      expected: "missing",
    },
    {
      name: "submitted evidence awaits review",
      requirement: {
        type: "ID",
        status: "submitted" as const,
        isRequired: true,
      },
      expected: "awaiting_review",
    },
    {
      name: "rejected evidence is actionable",
      requirement: {
        type: "ID",
        status: "pending" as const,
        isRequired: true,
        rejectedAt: NOW - DAY,
        rejectionReason: "Unreadable image",
      },
      expected: "rejected",
    },
    {
      name: "expired verified evidence needs renewal",
      requirement: {
        type: "License",
        status: "verified" as const,
        expiryDate: NOW - 1,
        reminderDaysBeforeDue: 30,
      },
      expected: "expired",
    },
    {
      name: "verified evidence in its reminder window is expiring",
      requirement: {
        type: "License",
        status: "verified" as const,
        expiryDate: NOW + 5 * DAY,
        reminderDaysBeforeDue: 7,
      },
      expected: "expiring",
    },
    {
      name: "submitted evidence needing no review is complete",
      requirement: {
        type: "Acknowledgement",
        status: "submitted" as const,
        requiresVerification: false,
      },
      expected: "complete",
    },
    {
      name: "unsubmitted optional evidence stays optional",
      requirement: {
        type: "Portfolio",
        status: "pending" as const,
        isRequired: false,
      },
      expected: "optional",
    },
  ])("derives $name", ({ requirement, expected }) => {
    expect(deriveRequirementState(requirement, NOW).state).toBe(expected);
  });

  it("summarizes actionable states and excludes optional items from completion", () => {
    const summary = summarizeEmployeeRequirements(
      [
        { type: "ID", status: "pending", isRequired: true },
        { type: "License", status: "submitted", isRequired: true },
        { type: "Policy", status: "verified", isRequired: true },
        { type: "Portfolio", status: "pending", isRequired: false },
      ],
      NOW,
    );

    expect(summary).toEqual({
      total: 4,
      required: 3,
      complete: 1,
      missing: 1,
      awaitingReview: 1,
      rejected: 0,
      expiring: 0,
      expired: 0,
      completionPercent: 33,
    });
  });

  it("summarizes the HR workspace by employee and action queue", () => {
    expect(
      summarizeRequirementWorkspace(
        [
          {
            employeeId: "employee-1",
            requirements: [
              { type: "ID", status: "verified", isRequired: true },
            ],
          },
          {
            employeeId: "employee-2",
            requirements: [
              { type: "ID", status: "pending", isRequired: true },
              { type: "License", status: "submitted", isRequired: true },
            ],
          },
          {
            employeeId: "employee-3",
            requirements: [
              {
                type: "License",
                status: "verified",
                isRequired: true,
                expiryDate: NOW - DAY,
              },
            ],
          },
        ],
        NOW,
      ),
    ).toEqual({
      employees: 3,
      compliantEmployees: 1,
      attentionEmployees: 2,
      missing: 1,
      awaitingReview: 1,
      rejected: 0,
      expiring: 0,
      expired: 1,
    });
  });
});
