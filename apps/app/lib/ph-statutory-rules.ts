export const PH_STATUTORY_RULE_VERSION_2025 = "ph-2025-01" as const;

export type PhStatutoryRuleVersion = typeof PH_STATUTORY_RULE_VERSION_2025;

export type PhStatutoryRuleSet = Readonly<{
  version: PhStatutoryRuleVersion;
  effectiveFrom: number;
  sssScheduleVersion: "sss-2025-01";
  philHealth: Readonly<{
    rate: number;
    monthlyFloor: number;
    monthlyCeiling: number;
    employeeShareRatio: number;
  }>;
  pagibig: Readonly<{
    monthlyFundSalaryCeiling: number;
    employeeRateThreshold: number;
    employeeRateAtOrBelowThreshold: number;
    employeeRateAboveThreshold: number;
    employerRate: number;
  }>;
  withholdingTaxScheduleVersion: "train-2023";
}>;

function freezeRuleSet(ruleSet: PhStatutoryRuleSet): PhStatutoryRuleSet {
  Object.freeze(ruleSet.philHealth);
  Object.freeze(ruleSet.pagibig);
  return Object.freeze(ruleSet);
}

const PH_STATUTORY_RULE_SETS: readonly PhStatutoryRuleSet[] = Object.freeze([
  freezeRuleSet({
    version: PH_STATUTORY_RULE_VERSION_2025,
    effectiveFrom: Date.parse("2025-01-01T00:00:00+08:00"),
    sssScheduleVersion: "sss-2025-01",
    philHealth: {
      rate: 0.05,
      monthlyFloor: 10_000,
      monthlyCeiling: 100_000,
      employeeShareRatio: 0.5,
    },
    pagibig: {
      monthlyFundSalaryCeiling: 10_000,
      employeeRateThreshold: 1_500,
      employeeRateAtOrBelowThreshold: 0.01,
      employeeRateAboveThreshold: 0.02,
      employerRate: 0.02,
    },
    withholdingTaxScheduleVersion: "train-2023",
  }),
]);

export function resolvePhStatutoryRuleSet(
  effectiveAt: number,
  lockedVersion?: string,
): PhStatutoryRuleSet {
  if (lockedVersion) {
    const locked = PH_STATUTORY_RULE_SETS.find(
      (ruleSet) => ruleSet.version === lockedVersion,
    );
    if (!locked) {
      throw new Error(`Unsupported statutory rule version: ${lockedVersion}.`);
    }
    return locked;
  }
  if (!Number.isFinite(effectiveAt)) {
    throw new Error("A valid statutory rule effective date is required.");
  }
  const resolved = [...PH_STATUTORY_RULE_SETS]
    .reverse()
    .find((ruleSet) => ruleSet.effectiveFrom <= effectiveAt);
  if (resolved) return resolved;

  const earliest = PH_STATUTORY_RULE_SETS[0];
  if (!earliest)
    throw new Error("No Philippine statutory rules are configured.");
  return earliest;
}
