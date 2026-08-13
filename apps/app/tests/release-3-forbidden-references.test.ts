import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readSource(name: string): string {
  return readFileSync(new URL(`../convex/${name}`, import.meta.url), "utf8");
}

describe("Release 3 forbidden legacy writes", () => {
  it("keeps organization, settings, and identity mutations normalized-only", () => {
    const organizations = readSource("organizations.ts");
    const settings = readSource("settings.ts");
    const invitations = readSource("invitations.ts");

    expect(organizations).not.toContain("firstPayDate: 15, // Default");
    expect(organizations).not.toContain("// Also update legacy fields");
    expect(settings).not.toContain("buildSettingsAuditPatch");
    expect(settings).not.toContain("leaveTrackerByYear:");
    expect(settings).not.toContain("recruitmentTableColumns: args.columns,");
    expect(invitations).not.toContain(".withIndex(\"by_token\"");
  });

  it("keeps leave, workflow, communication, document, and asset writes normalized-only", () => {
    const sources = {
      leave: readSource("leave.ts"),
      evaluations: readSource("evaluations.ts"),
      recruitment: readSource("recruitment.ts"),
      chat: readSource("chat.ts"),
      documents: readSource("documents.ts"),
      accounting: readSource("accounting.ts"),
      assets: readSource("assets.ts"),
    };

    expect(sources.leave).not.toContain("{ leaveCredits, updatedAt: now }");
    expect(sources.leave).not.toContain("supportingDocuments: args.supportingDocuments");
    expect(sources.evaluations).not.toContain("assignedReviewerIds: args.reviewerIds");
    expect(sources.recruitment).not.toContain("requirements: defaultRequirements,");
    expect(sources.chat).not.toContain("readBy: [userRecord._id]");
    expect(sources.documents).not.toContain("contentVersion: 1,\n      attachments:");
    expect(sources.accounting).not.toContain("receipts: args.receipts");
    expect(sources.assets).not.toContain("notes: args.notes,\n      maintenanceHistory:");
  });

  it("does not read legacy leave settings or attachment projections", () => {
    const leave = readSource("leave.ts");
    const files = readSource("files.ts");
    const payroll = readSource("payroll.ts");

    expect(leave).not.toContain('ctx.db.query("settings")');
    expect(files).not.toContain("request.supportingDocuments");
    expect(files).not.toContain("employee.requirements");
    expect(payroll).not.toContain("settings?.leaveTrackerByYear");
  });
});
