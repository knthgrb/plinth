import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("evaluation workflow hardening", () => {
  it("models templates, review cycles, reviewer assignment, locking, and history", () => {
    const schemaSource = readSource("../convex/schema.ts");
    const evaluationsSource = readSource("../convex/evaluations.ts");

    expect(schemaSource).toContain("evaluationTemplates");
    expect(schemaSource).toContain("templateId");
    expect(schemaSource).toContain("reviewCycle");
    expect(schemaSource).toContain("selfReview");
    expect(schemaSource).toContain("managerReview");
    expect(schemaSource).toContain("assignedReviewerIds");
    expect(schemaSource).toContain("lockedAt");
    expect(schemaSource).toContain("history");
    expect(evaluationsSource).toContain("createEvaluationTemplate");
    expect(evaluationsSource).toContain("assignEvaluationReviewers");
    expect(evaluationsSource).toContain("lockEvaluation");
    expect(evaluationsSource).toContain("appendEvaluationHistory");
  });

  it("surfaces evaluation workflow controls in the editor", () => {
    const contentSource = readSource(
      "../app/[organizationId]/evaluations/_components/evaluations-content.tsx",
    );

    expect(contentSource).toContain("Template");
    expect(contentSource).toContain("Review cycle");
    expect(contentSource).toContain("Self review");
    expect(contentSource).toContain("Manager review");
    expect(contentSource).toContain("Assigned reviewers");
    expect(contentSource).toContain("Lock evaluation");
  });
});
