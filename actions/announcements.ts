"use server";

import { AnnouncementsService } from "@/services/announcements-service";

export async function getAnnouncements(data: {
  organizationId: string;
  employeeId?: string;
}) {
  return AnnouncementsService.getAnnouncements(data);
}

export async function createAnnouncement(data: {
  organizationId: string;
  title: string;
  content: string;
  priority: "normal" | "important" | "urgent";
  targetAudience: "all" | "department" | "specific-employees";
  departments?: string[];
  specificEmployees?: string[];
  expiryDate?: number;
  attachments?: string[];
  acknowledgementRequired: boolean;
}) {
  return AnnouncementsService.createAnnouncement(data);
}

export async function updateAnnouncement(data: {
  announcementId: string;
  organizationId: string;
  title?: string;
  content?: string;
  priority?: "normal" | "important" | "urgent";
  targetAudience?: "all" | "department" | "specific-employees";
  departments?: string[];
  specificEmployees?: string[];
  expiryDate?: number;
  attachments?: string[];
  acknowledgementRequired?: boolean;
}) {
  return AnnouncementsService.updateAnnouncement(data);
}

export async function deleteAnnouncement(data: {
  announcementId: string;
  organizationId: string;
}) {
  return AnnouncementsService.deleteAnnouncement(data);
}

export async function addReaction(data: {
  announcementId: string;
  organizationId: string;
  emoji: string;
}) {
  return AnnouncementsService.addReaction(data);
}

export async function removeReaction(data: {
  announcementId: string;
  organizationId: string;
}) {
  return AnnouncementsService.removeReaction(data);
}
