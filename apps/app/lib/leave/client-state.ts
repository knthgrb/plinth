export type LeaveSettingsSector = "private" | "government";
export type CompanyPolicyQuickStart =
  | "vacation"
  | "sick"
  | "anniversary"
  | "custom";

export interface CompanyPolicyQuickStartDraft {
  name: string;
  entitlementMethod: "annual" | "anniversary";
  annualUnits: number;
  eligibilityBasis: "hire_date" | "regularization_date";
  completedServiceMonths: number;
}
export type LeaveSettingsMigrationState =
  | "pending"
  | "awaiting_sector_confirmation"
  | "ready"
  | "active"
  | "blocked";

export interface LeaveSettingsSummary {
  migrationState?: LeaveSettingsMigrationState;
  employmentSector?: LeaveSettingsSector;
  leaveTrackerMode?: "general" | "by_type";
  companyLeaveDefaultMode?: "pooled" | "by_type";
}

export interface LeavePolicySummary {
  id: string;
  name: string;
  category: "statutory" | "company" | "unpaid";
  state: "active" | "archived";
}

export interface LeaveSettingsViewModel {
  setupStatus: "new" | "confirm_sector" | "configured";
  setupTitle: string;
  sector?: LeaveSettingsSector;
  companyModes: Array<"pooled" | "by_type">;
  companyLeaveDefaultMode?: "pooled" | "by_type";
  requiredAccountLabels: string[];
  statutoryPolicies: LeavePolicySummary[];
  companyPolicies: LeavePolicySummary[];
  archivedPolicies: LeavePolicySummary[];
}

interface CompleteLeaveMigrationInput {
  runBatch: () => Promise<{ nextCursor?: string }>;
  activate: () => Promise<void>;
}

const MAX_LEAVE_MIGRATION_BATCHES = 10_000;

export function buildCompanyPolicyQuickStart(
  kind: CompanyPolicyQuickStart,
): CompanyPolicyQuickStartDraft {
  if (kind === "anniversary") {
    return {
      name: "Anniversary Leave",
      entitlementMethod: "anniversary",
      annualUnits: 15,
      eligibilityBasis: "hire_date",
      completedServiceMonths: 12,
    };
  }
  return {
    name:
      kind === "vacation"
        ? "Vacation Leave"
        : kind === "sick"
          ? "Sick Leave"
          : "",
    entitlementMethod: "annual",
    annualUnits: 5,
    eligibilityBasis: "hire_date",
    completedServiceMonths: 0,
  };
}

export async function completeLeaveMigration(
  input: CompleteLeaveMigrationInput,
): Promise<void> {
  for (let batch = 0; batch < MAX_LEAVE_MIGRATION_BATCHES; batch += 1) {
    const result = await input.runBatch();
    if (result.nextCursor === undefined) {
      await input.activate();
      return;
    }
  }

  throw new Error("Leave migration exceeded the supported batch limit");
}

export function buildLeaveSettingsViewModel(input: {
  settings: LeaveSettingsSummary | null;
  policies: readonly LeavePolicySummary[];
}): LeaveSettingsViewModel {
  const sector = input.settings?.employmentSector;
  const setupStatus =
    input.settings === null
      ? "new"
      : input.settings.migrationState !== "active" || sector === undefined
        ? "confirm_sector"
        : "configured";
  const activePolicies = input.policies.filter(
    (policy) => policy.state === "active",
  );
  return {
    setupStatus,
    setupTitle:
      setupStatus === "confirm_sector"
        ? "Confirm organization sector"
        : setupStatus === "new"
          ? "Set up leave policies"
          : "Leave policy settings",
    sector,
    companyModes: sector === "private" ? ["pooled", "by_type"] : [],
    companyLeaveDefaultMode:
      sector === undefined
        ? undefined
        : input.settings?.companyLeaveDefaultMode ??
          (sector === "government" || input.settings?.leaveTrackerMode === "by_type"
            ? "by_type"
            : "pooled"),
    requiredAccountLabels:
      sector === "government" ? ["Vacation Leave", "Sick Leave"] : [],
    statutoryPolicies: activePolicies.filter(
      (policy) => policy.category === "statutory",
    ),
    companyPolicies: activePolicies.filter(
      (policy) => policy.category !== "statutory",
    ),
    archivedPolicies: input.policies.filter(
      (policy) => policy.state === "archived",
    ),
  };
}

export function validatePolicyVersionDraft(input: {
  effectiveDate: string;
  reason: string;
}): { valid: true } | { valid: false; message: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveDate)) {
    return { valid: false, message: "Effective date is required" };
  }
  if (!input.reason.trim()) {
    return { valid: false, message: "Change reason is required" };
  }
  return { valid: true };
}
