import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getAuthedConvexClient } from "@/lib/convex-client";

export type AnnouncementAudience =
  | "all"
  | "department"
  | "specific-employees";
export type AnnouncementPriority = "normal" | "important" | "urgent";
export type AnnouncementPostAs = "admin" | "employee";

export type CreateAnnouncementInput = {
  organizationId: string;
  title: string;
  content: string;
  priority?: AnnouncementPriority;
  targetAudience: AnnouncementAudience;
  departments?: string[];
  specificEmployees?: string[];
  scheduledPublishDate?: number;
  attachments?: string[];
  attachmentContentTypes?: string[];
  postAs?: AnnouncementPostAs;
};

export type UpdateAnnouncementInput = Omit<
  Partial<CreateAnnouncementInput>,
  "organizationId" | "scheduledPublishDate"
> & {
  announcementId: string;
  organizationId: string;
  scheduledPublishDate?: number | null;
};

export class AnnouncementsService {
  static async getAnnouncements(data: {
    organizationId: string;
    includeScheduled?: boolean;
  }) {
    const convex = await getAuthedConvexClient();
    return convex.query(api.announcements.getAnnouncements, {
      organizationId: data.organizationId as Id<"organizations">,
      includeScheduled: data.includeScheduled,
    });
  }

  static async createAnnouncement(data: CreateAnnouncementInput) {
    const convex = await getAuthedConvexClient();
    return convex.mutation(api.announcements.createAnnouncement, {
      ...data,
      organizationId: data.organizationId as Id<"organizations">,
      specificEmployees: data.specificEmployees as
        | Id<"employees">[]
        | undefined,
      attachments: data.attachments as Id<"_storage">[] | undefined,
    });
  }

  static async updateAnnouncement(data: UpdateAnnouncementInput) {
    const convex = await getAuthedConvexClient();
    return convex.mutation(api.announcements.updateAnnouncement, {
      ...data,
      announcementId: data.announcementId as Id<"memos">,
      organizationId: data.organizationId as Id<"organizations">,
      specificEmployees: data.specificEmployees as
        | Id<"employees">[]
        | undefined,
      attachments: data.attachments as Id<"_storage">[] | undefined,
    });
  }

  static async deleteAnnouncement(data: {
    announcementId: string;
    organizationId: string;
  }) {
    const convex = await getAuthedConvexClient();
    return convex.mutation(api.announcements.deleteAnnouncement, {
      announcementId: data.announcementId as Id<"memos">,
      organizationId: data.organizationId as Id<"organizations">,
    });
  }
}
