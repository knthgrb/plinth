import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("announcement workflow hardening", () => {
  it("models scheduled, pinned, audience, and acknowledgement reminder metadata", () => {
    const schemaSource = readSource("../convex/schema.ts");
    const announcementsSource = readSource("../convex/announcements.ts");

    expect(schemaSource).toContain("scheduledPublishDate");
    expect(schemaSource).toContain("isPinned");
    expect(schemaSource).toContain("reminderCadenceDays");
    expect(schemaSource).toContain("reminderLastSentAt");
    expect(schemaSource).toContain("audienceSnapshot");
    expect(announcementsSource).toContain("getAnnouncementAudienceEmployeeIds");
    expect(announcementsSource).toContain("sendAnnouncementAcknowledgementReminders");
    expect(announcementsSource).toContain("m.publishedDate <= now");
    expect(announcementsSource).toContain("!m.expiryDate || m.expiryDate >= now");
  });

  it("lets admins schedule, pin, preview audience, and configure reminders", () => {
    const modalSource = readSource(
      "../app/[organizationId]/announcements/_components/create-announcement-modal.tsx",
    );
    const cardSource = readSource(
      "../app/[organizationId]/announcements/_components/announcement-card.tsx",
    );

    expect(modalSource).toContain("Scheduled publish date");
    expect(modalSource).toContain("Pin announcement");
    expect(modalSource).toContain("Reminder cadence days");
    expect(modalSource).toContain("Audience preview");
    expect(cardSource).toContain("Send reminder");
  });
});
