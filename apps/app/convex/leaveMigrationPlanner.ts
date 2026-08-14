export const LEAVE_ENGINE_MIGRATION_VERSION = 2;
export const GENERAL_LEAVE_MIGRATION_KEY = "__plinth_general_leave__";

export type LegacyLeaveTrackerMode = "general" | "by_type";

export type LegacyLeaveSettings = {
  leaveTrackerMode?: LegacyLeaveTrackerMode;
  proratedLeave?: boolean;
  leaveAccrualFrequency?: "monthly" | "semi_annual" | "annual";
  enableAnniversaryLeave?: boolean;
  anniversaryLeaveMaxDays?: number;
  maxConvertibleLeaveDays?: number;
  annualSil?: number;
  grantLeaveUponRegularization?: boolean;
  paidLeaveRequiresRegularization?: boolean;
  leaveGuidelines?: string;
  leaveRequestFormTemplate?: string;
};

export type LegacyLeaveBalance = {
  employeeId: string;
  year: number;
  leaveTypeKey: string;
  total: number;
  used: number;
  balance: number;
};

export type LeavePolicyMapping = {
  sourceKey: string;
  accountBehavior: "shared_pool" | "individual_account";
  poolKey?: string;
};

export type LeaveOpeningEntry = {
  employeeId: string;
  year: number;
  sourceKey: string;
  accountKey: string;
  kind: "opening_grant" | "opening_usage" | "migration_reconciliation";
  amount: number;
  reconciliationStatus: "matching" | "reconciliation_required";
  idempotencyKey: string;
};

export type LeaveBalanceProjectionPlan = {
  employeeId: string;
  year: number;
  sourceKey: string;
  accountKey: string;
  total: number;
  used: number;
  balance: number;
  reconciliationStatus: "matching" | "reconciliation_required";
  sourceLeaveTypeKeys: string[];
};

export type OrganizationLeaveMigrationPlan = {
  organizationId: string;
  cutoverCandidateAt: number;
  employmentSector?: "private" | "government";
  preservedSettings: LegacyLeaveSettings;
  policyMappings: LeavePolicyMapping[];
  balanceProjections: LeaveBalanceProjectionPlan[];
  openingEntries: LeaveOpeningEntry[];
  approvedRequestCount: number;
  reconciliationRequired: boolean;
};

export type PlanOrganizationLeaveMigrationArgs = {
  organizationId: string;
  cutoverCandidateAt: number;
  settings: LegacyLeaveSettings;
  balances: LegacyLeaveBalance[];
  approvedRequestCount: number;
};

function normalizeSourceKey(key: string): string {
  const normalized = key
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "unnamed";
}

function assertBalance(balance: LegacyLeaveBalance): void {
  for (const value of [balance.total, balance.used, balance.balance]) {
    if (!Number.isFinite(value)) throw new Error("Leave balance must be finite");
  }
}

function settingsForMigration(settings: LegacyLeaveSettings): LegacyLeaveSettings {
  return Object.fromEntries(
    Object.entries(settings).filter(([, value]) => value !== undefined),
  ) as LegacyLeaveSettings;
}

function mappingForBalance(
  mode: LegacyLeaveTrackerMode,
  balance: LegacyLeaveBalance,
): LeavePolicyMapping {
  if (mode === "general") {
    return {
      sourceKey: GENERAL_LEAVE_MIGRATION_KEY,
      accountBehavior: "shared_pool",
      poolKey: GENERAL_LEAVE_MIGRATION_KEY,
    };
  }
  return {
    sourceKey: normalizeSourceKey(balance.leaveTypeKey),
    accountBehavior: "individual_account",
  };
}

function openingEntriesForBalance(
  organizationId: string,
  balance: LeaveBalanceProjectionPlan,
  mapping: LeavePolicyMapping,
): LeaveOpeningEntry[] {
  const sourceKey = mapping.sourceKey;
  const accountKey = mapping.poolKey ?? sourceKey;
  const delta = balance.balance - (balance.total - balance.used);
  const reconciliationStatus = balance.reconciliationStatus;
  const entryBase = [
    organizationId,
    "leave-engine-v2",
    balance.employeeId,
    balance.year,
    accountKey,
    balance.sourceLeaveTypeKeys.join("+"),
  ].join(":");
  const entries: LeaveOpeningEntry[] = [
    {
      employeeId: balance.employeeId,
      year: balance.year,
      sourceKey,
      accountKey,
      kind: "opening_grant",
      amount: balance.total,
      reconciliationStatus,
      idempotencyKey: `${entryBase}:opening-grant`,
    },
    {
      employeeId: balance.employeeId,
      year: balance.year,
      sourceKey,
      accountKey,
      kind: "opening_usage",
      amount: -balance.used,
      reconciliationStatus,
      idempotencyKey: `${entryBase}:opening-usage`,
    },
  ];
  if (delta !== 0) {
    entries.push({
      employeeId: balance.employeeId,
      year: balance.year,
      sourceKey,
      accountKey,
      kind: "migration_reconciliation",
      amount: delta,
      reconciliationStatus,
      idempotencyKey: `${entryBase}:migration-reconciliation`,
    });
  }
  return entries;
}

export function planOrganizationLeaveMigration(
  args: PlanOrganizationLeaveMigrationArgs,
): OrganizationLeaveMigrationPlan {
  const mode = args.settings.leaveTrackerMode ?? "by_type";
  const balances = [...args.balances].sort((left, right) =>
    [left.employeeId, left.year, left.leaveTypeKey].join(":").localeCompare(
      [right.employeeId, right.year, right.leaveTypeKey].join(":"),
    ),
  );
  const policyMappingsBySourceKey = new Map<string, LeavePolicyMapping>();
  const grouped = new Map<string, LeaveBalanceProjectionPlan>();
  for (const balance of balances) {
    assertBalance(balance);
    const mapping = mappingForBalance(mode, balance);
    policyMappingsBySourceKey.set(mapping.sourceKey, mapping);
    const accountKey = mapping.poolKey ?? mapping.sourceKey;
    const key = [balance.employeeId, balance.year, accountKey].join(":");
    const existing = grouped.get(key);
    if (existing) {
      existing.total += balance.total;
      existing.used += balance.used;
      existing.balance += balance.balance;
      existing.sourceLeaveTypeKeys.push(normalizeSourceKey(balance.leaveTypeKey));
      continue;
    }
    grouped.set(key, {
      employeeId: balance.employeeId,
      year: balance.year,
      sourceKey: mapping.sourceKey,
      accountKey,
      total: balance.total,
      used: balance.used,
      balance: balance.balance,
      reconciliationStatus: "matching",
      sourceLeaveTypeKeys: [normalizeSourceKey(balance.leaveTypeKey)],
    });
  }
  const balanceProjections: LeaveBalanceProjectionPlan[] = [...grouped.values()]
    .map((projection) => ({
      ...projection,
      sourceLeaveTypeKeys: projection.sourceLeaveTypeKeys.sort(),
      reconciliationStatus:
        projection.balance === projection.total - projection.used
          ? ("matching" as const)
          : ("reconciliation_required" as const),
    }))
    .sort((left, right) =>
      [left.employeeId, left.year, left.accountKey]
        .join(":")
        .localeCompare([right.employeeId, right.year, right.accountKey].join(":")),
    );
  const openingEntries = balanceProjections.flatMap((projection) =>
    openingEntriesForBalance(
      args.organizationId,
      projection,
      policyMappingsBySourceKey.get(projection.sourceKey)!,
    ),
  );
  const reconciliationRequired = openingEntries.some(
    (entry) => entry.kind === "migration_reconciliation",
  );
  return {
    organizationId: args.organizationId,
    cutoverCandidateAt: args.cutoverCandidateAt,
    preservedSettings: settingsForMigration(args.settings),
    policyMappings: [...policyMappingsBySourceKey.values()].sort((left, right) =>
      left.sourceKey.localeCompare(right.sourceKey),
    ),
    balanceProjections,
    openingEntries,
    approvedRequestCount: args.approvedRequestCount,
    reconciliationRequired,
  };
}
