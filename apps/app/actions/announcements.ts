"use server";

import {
  AnnouncementsService,
  type CreateAnnouncementInput,
  type UpdateAnnouncementInput,
} from "@/services/announcements-service";

export async function getAnnouncements(data: {
  organizationId: string;
  includeScheduled?: boolean;
}) {
  return AnnouncementsService.getAnnouncements(data);
}

export async function createAnnouncement(data: CreateAnnouncementInput) {
  return AnnouncementsService.createAnnouncement(data);
}

export async function updateAnnouncement(data: UpdateAnnouncementInput) {
  return AnnouncementsService.updateAnnouncement(data);
}

export async function deleteAnnouncement(data: {
  announcementId: string;
  organizationId: string;
}) {
  return AnnouncementsService.deleteAnnouncement(data);
}
