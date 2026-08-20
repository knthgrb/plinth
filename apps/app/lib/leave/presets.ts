import type { LeavePolicyRules } from "@/lib/leave/types";

export interface LeavePresetPolicy {
  sourceKey: string;
  name: string;
  category: "company" | "statutory" | "unpaid";
  confidentiality: "standard" | "restricted";
  complianceRole?: "private_sil_minimum";
  enabledByDefault: boolean;
  rules: LeavePolicyRules;
  sourceUrl: string;
  sourceEffectiveDate: string;
}

export interface LeavePreset {
  sector: "private" | "government";
  policies: LeavePresetPolicy[];
}

const sources = {
  laborCode:
    "https://lawphil.net/statutes/presdecs/pd1974/pd_442_1974.html",
  maternity:
    "https://lawphil.net/statutes/repacts/ra2019/ra_11210_2019.html",
  paternity:
    "https://lawphil.net/statutes/repacts/ra1996/ra_8187_1996.html",
  soloParent:
    "https://lawphil.net/statutes/repacts/ra2022/ra_11861_2022.html",
  vawc: "https://lawphil.net/statutes/repacts/ra2004/ra_9262_2004.html",
  women:
    "https://lawphil.net/statutes/repacts/ra2009/ra_9710_2009.html",
  governmentLeave:
    "https://www.csc.gov.ph/phocadownload/userupload/irmo/mc/1998/mc41s1998.pdf",
  governmentFamilyLeave:
    "https://csc.gov.ph/phocadownload/userupload/irmo/mc/2021/MC05/CSC%20Resolution%20No.%202100020%20dated%2007%20January%202021.pdf",
  studyLeave:
    "https://csc.gov.ph/phocadownload/userupload/irmo/mc/2004/mc21s2004.pdf",
  rehabilitation:
    "https://www.csc.gov.ph/downloads/category/80-2013?download=1305%3Apolicy-resolution-no-1300065",
  emergency:
    "https://www.csc.gov.ph/phocadownload/userupload/irmo/mc/2012/mc16s2012spclEL.pdf",
  wellness:
    "https://www.csc.gov.ph/phocadownload/userupload/irmo/mc/2026/MC%20No.%2001%20s.%202026%20-%20Wellness%20Leave%20Policy.pdf",
} as const;

export function buildPrivateSectorPreset(): LeavePreset {
  return {
    sector: "private",
    policies: [
      policy(
        "private_sil",
        "Service Incentive Leave",
        annualRules({
          accountBehavior: "shared_pool",
          poolKey: "company_leave",
          payTreatment: "company_paid",
          annualUnits: 5,
          completedServiceMonths: 12,
          carryoverMode: "unlimited",
          conversionAllowed: true,
        }),
        sources.laborCode,
        "1974-11-01",
        { complianceRole: "private_sil_minimum" },
      ),
      eventPolicy(
        "private_maternity",
        "Maternity Leave",
        "calendar_days",
        "statutory_benefit_supported",
        sources.maternity,
        "2019-03-11",
        {
          eventEntitlementRules: [
            {
              eventType: "maternity",
              benefitVariant: "live_birth",
              maximumUnits: 105,
            },
            {
              eventType: "maternity",
              benefitVariant: "live_birth_solo_parent",
              maximumUnits: 120,
            },
            { eventType: "miscarriage", maximumUnits: 60 },
            {
              eventType: "emergency_termination_of_pregnancy",
              maximumUnits: 60,
            },
          ],
        },
      ),
      eventPolicy(
        "private_maternity_unpaid_extension",
        "Maternity Leave – Unpaid Extension",
        "calendar_days",
        "unpaid",
        sources.maternity,
        "2019-03-11",
        {
          requiresEvidence: false,
          eventEntitlementRules: [
            {
              eventType: "maternity",
              benefitVariant: "live_birth",
              maximumUnits: 30,
            },
            {
              eventType: "maternity",
              benefitVariant: "live_birth_solo_parent",
              maximumUnits: 30,
            },
          ],
        },
      ),
      eventPolicy(
        "private_paternity",
        "Paternity Leave",
        "calendar_days",
        "statutory_paid",
        sources.paternity,
        "1996-07-15",
        {
          eventEntitlementRules: [
            { eventType: "spouse_delivery", maximumUnits: 7 },
          ],
        },
      ),
      policy(
        "private_solo_parent",
        "Solo Parent Leave",
        annualRules({
          accountBehavior: "non_credit",
          payTreatment: "statutory_paid",
          annualUnits: 7,
          eligibilityBasis: "verified_qualification",
          completedServiceMonths: 6,
        }),
        sources.soloParent,
        "2022-06-04",
        { confidentiality: "restricted" },
      ),
      eventPolicy(
        "private_vawc",
        "VAWC Leave",
        "scheduled_work",
        "statutory_paid",
        sources.vawc,
        "2004-03-08",
        {
          eventEntitlementRules: [
            { eventType: "other_protected", maximumUnits: 10 },
          ],
        },
      ),
      eventPolicy(
        "private_special_leave_women",
        "Special Leave for Women",
        "event_defined",
        "statutory_paid",
        sources.women,
        "2009-08-14",
        {
          eligibility: { basis: "hire_date", completedServiceMonths: 6 },
          eventEntitlementRules: [
            { eventType: "surgery", maximumUnits: 60 },
          ],
        },
      ),
    ],
  };
}

export function buildGovernmentPreset(): LeavePreset {
  return {
    sector: "government",
    policies: [
      policy(
        "government_vacation",
        "Vacation Leave",
        monthlyGovernmentRules(15, true),
        sources.governmentLeave,
        "1998-12-24",
      ),
      policy(
        "government_sick",
        "Sick Leave",
        monthlyGovernmentRules(15, true),
        sources.governmentLeave,
        "1998-12-24",
      ),
      policy(
        "government_forced_leave",
        "Mandatory or Forced Leave",
        sharedGovernmentRules("government_vacation"),
        sources.governmentLeave,
        "1998-12-24",
      ),
      policy(
        "government_special_privilege",
        "Special Privilege Leave",
        annualGovernmentRules(3),
        sources.governmentLeave,
        "1998-12-24",
      ),
      eventPolicy(
        "government_maternity",
        "Maternity Leave",
        "calendar_days",
        "government_paid",
        sources.governmentFamilyLeave,
        "2021-01-07",
        {
          eventEntitlementRules: [
            {
              eventType: "maternity",
              benefitVariant: "live_birth",
              maximumUnits: 105,
            },
            {
              eventType: "maternity",
              benefitVariant: "live_birth_solo_parent",
              maximumUnits: 120,
            },
            { eventType: "miscarriage", maximumUnits: 60 },
            {
              eventType: "emergency_termination_of_pregnancy",
              maximumUnits: 60,
            },
          ],
        },
      ),
      eventPolicy(
        "government_maternity_unpaid_extension",
        "Maternity Leave – Unpaid Extension",
        "calendar_days",
        "unpaid",
        sources.governmentFamilyLeave,
        "2021-01-07",
        {
          requiresEvidence: false,
          eventEntitlementRules: [
            {
              eventType: "maternity",
              benefitVariant: "live_birth",
              maximumUnits: 30,
            },
            {
              eventType: "maternity",
              benefitVariant: "live_birth_solo_parent",
              maximumUnits: 30,
            },
          ],
        },
      ),
      eventPolicy(
        "government_paternity",
        "Paternity Leave",
        "scheduled_work",
        "government_paid",
        sources.governmentFamilyLeave,
        "2021-01-07",
        {
          eventEntitlementRules: [
            { eventType: "spouse_delivery", maximumUnits: 7 },
          ],
        },
      ),
      policy(
        "government_solo_parent",
        "Solo Parent Leave",
        annualRules({
          accountBehavior: "non_credit",
          payTreatment: "government_paid",
          annualUnits: 7,
          eligibilityBasis: "verified_qualification",
          completedServiceMonths: 6,
        }),
        sources.soloParent,
        "2022-06-04",
        { confidentiality: "restricted" },
      ),
      eventPolicy(
        "government_vawc",
        "VAWC Leave",
        "scheduled_work",
        "government_paid",
        sources.vawc,
        "2004-03-08",
        {
          eventEntitlementRules: [
            { eventType: "other_protected", maximumUnits: 10 },
          ],
        },
      ),
      eventPolicy(
        "government_special_leave_women",
        "Special Leave for Women",
        "event_defined",
        "government_paid",
        sources.women,
        "2009-08-14",
        {
          eligibility: { basis: "hire_date", completedServiceMonths: 6 },
          eventEntitlementRules: [
            { eventType: "surgery", maximumUnits: 60 },
          ],
        },
      ),
      eventPolicy(
        "government_study",
        "Study Leave",
        "event_defined",
        "government_paid",
        sources.studyLeave,
        "2004-09-14",
        { confidentiality: "standard" },
      ),
      eventPolicy(
        "government_rehabilitation",
        "Rehabilitation Privilege",
        "event_defined",
        "government_paid",
        sources.rehabilitation,
        "2013-01-10",
      ),
      eventPolicy(
        "government_emergency",
        "Special Emergency Leave",
        "scheduled_work",
        "government_paid",
        sources.emergency,
        "2012-10-17",
        {
          confidentiality: "standard",
          maximumUnitsPerEvent: 5,
          maximumUnitsPerYear: 5,
          eventUseWindowDays: 30,
        },
      ),
      eventPolicy(
        "government_adoption",
        "Adoption Leave",
        "event_defined",
        "government_paid",
        sources.governmentFamilyLeave,
        "2021-01-07",
      ),
      policy(
        "government_wellness",
        "Wellness Leave",
        annualGovernmentRules(5),
        sources.wellness,
        "2026-01-01",
        { enabledByDefault: false },
      ),
    ],
  };
}

function policy(
  sourceKey: string,
  name: string,
  rules: LeavePolicyRules,
  sourceUrl: string,
  sourceEffectiveDate: string,
  options: {
    complianceRole?: "private_sil_minimum";
    confidentiality?: "standard" | "restricted";
    enabledByDefault?: boolean;
  } = {},
): LeavePresetPolicy {
  return {
    sourceKey,
    name,
    category: "statutory",
    confidentiality: options.confidentiality ?? "standard",
    complianceRole: options.complianceRole,
    enabledByDefault: options.enabledByDefault ?? true,
    rules,
    sourceUrl,
    sourceEffectiveDate,
  };
}

function eventPolicy(
  sourceKey: string,
  name: string,
  durationBasis: LeavePolicyRules["durationBasis"],
  payTreatment: LeavePolicyRules["payTreatment"],
  sourceUrl: string,
  sourceEffectiveDate: string,
  options: {
    confidentiality?: "standard" | "restricted";
    eligibility?: LeavePolicyRules["eligibility"];
    maximumUnitsPerEvent?: number;
    maximumUnitsPerYear?: number;
    eventUseWindowDays?: number;
    eventEntitlementRules?: LeavePolicyRules["eventEntitlementRules"];
    requiresEvidence?: boolean;
  } = {},
): LeavePresetPolicy {
  return policy(
    sourceKey,
    name,
    {
      accountBehavior: "non_credit",
      payTreatment,
      durationBasis,
      entitlementMethod: "event_based",
      eligibility: options.eligibility ?? {
        basis: "event",
        completedServiceMonths: 0,
      },
      prorationMethod: "none",
      roundingIncrement: 1,
      carryover: { mode: "none" },
      conversion: { allowed: false },
      qualifyingEventRequired: true,
      maximumUnitsPerEvent: options.maximumUnitsPerEvent,
      maximumUnitsPerYear: options.maximumUnitsPerYear,
      eventUseWindowDays: options.eventUseWindowDays,
      eventEntitlementRules: options.eventEntitlementRules,
      ...(options.requiresEvidence === false
        ? {}
        : {
            requiredDocumentRules: [
              {
                documentType: "qualifying_event_evidence",
                requiredBefore: "submission",
              },
            ],
          }),
    },
    sourceUrl,
    sourceEffectiveDate,
    { confidentiality: options.confidentiality ?? "restricted" },
  );
}

function annualRules(options: {
  accountBehavior: LeavePolicyRules["accountBehavior"];
  payTreatment: LeavePolicyRules["payTreatment"];
  annualUnits: number;
  poolKey?: string;
  eligibilityBasis?: LeavePolicyRules["eligibility"]["basis"];
  completedServiceMonths?: number;
  carryoverMode?: LeavePolicyRules["carryover"]["mode"];
  conversionAllowed?: boolean;
}): LeavePolicyRules {
  return {
    accountBehavior: options.accountBehavior,
    poolKey: options.poolKey,
    payTreatment: options.payTreatment,
    durationBasis: "scheduled_work",
    entitlementMethod: "annual",
    annualUnits: options.annualUnits,
    eligibility: {
      basis: options.eligibilityBasis ?? "hire_date",
      completedServiceMonths: options.completedServiceMonths ?? 0,
    },
    prorationMethod: "none",
    roundingIncrement: 0.25,
    carryover: { mode: options.carryoverMode ?? "none" },
    conversion: { allowed: options.conversionAllowed ?? false },
  };
}

function monthlyGovernmentRules(
  annualUnits: number,
  conversionAllowed: boolean,
): LeavePolicyRules {
  return {
    ...annualRules({
      accountBehavior: "individual_account",
      payTreatment: "government_paid",
      annualUnits,
      carryoverMode: "unlimited",
      conversionAllowed,
    }),
    entitlementMethod: "monthly",
  };
}

function annualGovernmentRules(annualUnits: number): LeavePolicyRules {
  return annualRules({
    accountBehavior: "individual_account",
    payTreatment: "government_paid",
    annualUnits,
  });
}

function sharedGovernmentRules(poolKey: string): LeavePolicyRules {
  return {
    accountBehavior: "shared_pool",
    poolKey,
    payTreatment: "government_paid",
    durationBasis: "scheduled_work",
    entitlementMethod: "none",
    eligibility: { basis: "hire_date", completedServiceMonths: 0 },
    prorationMethod: "none",
    roundingIncrement: 0.25,
    carryover: { mode: "unlimited" },
    conversion: { allowed: false },
  };
}
