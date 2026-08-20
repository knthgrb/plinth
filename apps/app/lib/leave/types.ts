export type LeaveAccountBehavior =
  | "shared_pool"
  | "individual_account"
  | "non_credit";

export type LeavePayTreatment =
  | "company_paid"
  | "statutory_paid"
  | "government_paid"
  | "statutory_benefit_supported"
  | "unpaid";

export type LeaveDurationBasis =
  | "scheduled_work"
  | "calendar_days"
  | "event_defined";

export type LeaveBenefitEventType =
  | "maternity"
  | "miscarriage"
  | "emergency_termination_of_pregnancy"
  | "spouse_delivery"
  | "surgery"
  | "adoption"
  | "calamity"
  | "other_protected";

export interface LeaveEventEntitlementRule {
  eventType: LeaveBenefitEventType;
  benefitVariant?: string;
  maximumUnits: number;
}

export type LeaveProrationMethod =
  | "none"
  | "calendar_months"
  | "actual_days"
  | "legacy_15th_day";

export type LeaveLedgerKind =
  | "opening_grant"
  | "opening_usage"
  | "grant"
  | "accrual"
  | "reservation"
  | "reservation_release"
  | "usage"
  | "restoration"
  | "adjustment"
  | "carryover"
  | "expiration"
  | "conversion"
  | "migration_reconciliation";

export interface LeaveLedgerEntryInput {
  kind: LeaveLedgerKind;
  amount: number;
}

export interface LeaveBalanceProjection {
  granted: number;
  used: number;
  reserved: number;
  converted: number;
  expired: number;
  available: number;
}

export interface LeavePolicyRules {
  accountBehavior: LeaveAccountBehavior;
  poolKey?: string;
  payTreatment: LeavePayTreatment;
  durationBasis: LeaveDurationBasis;
  entitlementMethod:
    | "annual"
    | "monthly"
    | "semi_annual"
    | "anniversary"
    | "event_based"
    | "none";
  annualUnits?: number;
  eligibility: {
    basis:
      | "hire_date"
      | "regularization_date"
      | "verified_qualification"
      | "event";
    completedServiceMonths: number;
  };
  prorationMethod: LeaveProrationMethod;
  roundingIncrement: 0.25 | 0.5 | 1;
  carryover: { mode: "none" | "capped" | "unlimited"; capUnits?: number };
  conversion: { allowed: boolean; maxUnits?: number };
  qualifyingEventRequired?: boolean;
  maximumUnitsPerEvent?: number;
  maximumUnitsPerYear?: number;
  eventUseWindowDays?: number;
  eventEntitlementRules?: LeaveEventEntitlementRule[];
  requiredDocumentRules?: Array<{
    documentType: string;
    minimumDuration?: number;
    requiredBefore: "submission" | "approval";
  }>;
}
