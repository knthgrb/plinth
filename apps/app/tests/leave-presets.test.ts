import { describe, expect, it } from "vitest";
import {
  buildGovernmentPreset,
  buildPrivateSectorPreset,
} from "@/lib/leave/presets";

describe("Philippine leave presets", () => {
  it("builds the protected five-day private SIL baseline", () => {
    expect(
      buildPrivateSectorPreset().policies.find(
        (policy) => policy.sourceKey === "private_sil",
      ),
    ).toMatchObject({
      category: "statutory",
      complianceRole: "private_sil_minimum",
      rules: {
        annualUnits: 5,
        durationBasis: "scheduled_work",
        conversion: { allowed: true },
      },
    });
  });

  it("keeps government vacation, sick, and wellness separate", () => {
    const preset = buildGovernmentPreset();

    expect(
      preset.policies.find(
        (policy) => policy.sourceKey === "government_vacation",
      )?.rules.annualUnits,
    ).toBe(15);
    expect(
      preset.policies.find(
        (policy) => policy.sourceKey === "government_sick",
      )?.rules.annualUnits,
    ).toBe(15);
    expect(
      preset.policies.find(
        (policy) => policy.sourceKey === "government_wellness",
      )?.enabledByDefault,
    ).toBe(false);
  });

  it("returns fresh policy objects on every build", () => {
    const first = buildPrivateSectorPreset();
    const second = buildPrivateSectorPreset();

    first.policies[0].name = "Changed locally";

    expect(second.policies[0].name).not.toBe("Changed locally");
  });

  it("requires both a qualifying surgery and six months service for women's leave", () => {
    for (const preset of [
      buildPrivateSectorPreset(),
      buildGovernmentPreset(),
    ]) {
      const policy = preset.policies.find((candidate) =>
        candidate.sourceKey.endsWith("special_leave_women"),
      );

      expect(policy?.rules).toMatchObject({
        entitlementMethod: "event_based",
        eligibility: { basis: "hire_date", completedServiceMonths: 6 },
        qualifyingEventRequired: true,
      });
    }
  });

  it("keeps special emergency leave event-qualified and outside credit balances", () => {
    const emergency = buildGovernmentPreset().policies.find(
      (policy) => policy.sourceKey === "government_emergency",
    );

    expect(emergency?.rules).toMatchObject({
      accountBehavior: "non_credit",
      durationBasis: "scheduled_work",
      entitlementMethod: "event_based",
      qualifyingEventRequired: true,
      maximumUnitsPerEvent: 5,
      maximumUnitsPerYear: 5,
      eventUseWindowDays: 30,
    });
  });

  it("records complete ISO source-effective dates", () => {
    const policies = [
      ...buildPrivateSectorPreset().policies,
      ...buildGovernmentPreset().policies,
    ];

    for (const policy of policies) {
      expect(policy.sourceEffectiveDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
