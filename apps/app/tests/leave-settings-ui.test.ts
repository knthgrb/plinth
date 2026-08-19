import { describe, expect, it } from "vitest";
import {
  buildLeaveSettingsViewModel,
  completeLeaveMigration,
  validatePolicyVersionDraft,
} from "../lib/leave/client-state";

const policies = [
  {
    id: "sil",
    name: "Service Incentive Leave",
    category: "statutory" as const,
    state: "active" as const,
  },
  {
    id: "vacation",
    name: "Vacation Leave",
    category: "company" as const,
    state: "active" as const,
  },
];

describe("leave settings UI state", () => {
  it("asks migrated organizations to confirm sector without changing policies", () => {
    const model = buildLeaveSettingsViewModel({
      settings: { migrationState: "pending", leaveTrackerMode: "general" },
      policies,
    });

    expect(model.setupStatus).toBe("confirm_sector");
    expect(model.setupTitle).toBe("Confirm organization sector");
    expect(model.companyPolicies).toEqual([policies[1]]);
    expect(model.statutoryPolicies).toEqual([policies[0]]);
  });

  it("offers pooled or by-type leave for private companies and separate vacation and sick accounts for government", () => {
    expect(
      buildLeaveSettingsViewModel({ settings: null, policies: [] }).companyModes,
    ).toEqual([]);
    expect(
      buildLeaveSettingsViewModel({
        settings: {
          migrationState: "active",
          employmentSector: "private",
          leaveTrackerMode: "general",
        },
        policies: [],
      }).companyModes,
    ).toEqual(["pooled", "by_type"]);
    expect(
      buildLeaveSettingsViewModel({
        settings: {
          migrationState: "active",
          employmentSector: "government",
          leaveTrackerMode: "by_type",
        },
        policies: [],
      }).requiredAccountLabels,
    ).toEqual(["Vacation Leave", "Sick Leave"]);
  });

  it("requires an effective date and a meaningful reason before saving", () => {
    expect(
      validatePolicyVersionDraft({ effectiveDate: "", reason: "Annual update" }),
    ).toEqual({ valid: false, message: "Effective date is required" });
    expect(
      validatePolicyVersionDraft({ effectiveDate: "2026-09-01", reason: " " }),
    ).toEqual({ valid: false, message: "Change reason is required" });
    expect(
      validatePolicyVersionDraft({
        effectiveDate: "2026-09-01",
        reason: "Annual policy update",
      }),
    ).toEqual({ valid: true });
  });

  it("finishes every migration batch before activating leave settings", async () => {
    const events: string[] = [];
    const batches = [
      { nextCursor: "migration:balances" },
      { nextCursor: "audit:requests" },
      {},
    ];

    await completeLeaveMigration({
      runBatch: async () => {
        events.push("batch");
        return batches.shift() ?? {};
      },
      activate: async () => {
        events.push("activate");
      },
    });

    expect(events).toEqual(["batch", "batch", "batch", "activate"]);
  });
});
