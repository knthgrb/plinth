import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("recruitment workflow hardening", () => {
  it("models pipeline history, scorecards, interviewers, offers, source tracking, and conversion links", () => {
    const schemaSource = readSource("../convex/schema.ts");
    const recruitmentSource = readSource("../convex/recruitment.ts");

    expect(schemaSource).toContain("applicantStageEvents");
    expect(schemaSource).toContain("applicantScorecards");
    expect(schemaSource).toContain("interviewers");
    expect(schemaSource).toContain("applicantOfferEvents");
    expect(schemaSource).toContain("source");
    expect(schemaSource).toContain("convertedEmployeeId");
    expect(recruitmentSource).toContain("addApplicantScorecard");
    expect(recruitmentSource).toContain("requestOfferApproval");
    expect(recruitmentSource).toContain("approveOffer");
    expect(recruitmentSource).toContain("buildDefaultRequirementsForConvertedEmployee");
    expect(recruitmentSource).toContain("convertedEmployeeId: employeeId");
  });

  it("surfaces recruitment workflow controls in the applicant UI", () => {
    const pageSource = readSource("../app/[organizationId]/recruitment/[jobId]/page.tsx");

    expect(pageSource).toContain("Source");
    expect(pageSource).toContain("Pipeline");
    expect(pageSource).toContain("Scorecards");
    expect(pageSource).toContain("Offer approval");
    expect(pageSource).toContain("Convert to employee");
  });
});
