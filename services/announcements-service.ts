import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { getAuthedConvexClient } from "@/lib/convex-client";

export class AnnouncementsService {
  static async getAnnouncements(data: {
    organizationId: string;
    employeeId?: string;
  }) {
    const convex = await getAuthedConvexClient();
    return await (convex.query as any)(
      (api as any).announcements.getAnnouncements,
      {
        organizationId: data.organizationId as Id<"organizations">,
        employeeId: data.employeeId as Id<"employees"> | undefined,
      }
    );
  }

  static async createAnnouncement(data: {
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
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)(
      (api as any).announcements.createAnnouncement,
      {
        organizationId: data.organizationId as Id<"organizations">,
        title: data.title,
        content: data.content,
        priority: data.priority,
        targetAudience: data.targetAudience,
        departments: data.departments,
        specificEmployees: data.specificEmployees as
          | Id<"employees">[]
          | undefined,
        expiryDate: data.expiryDate,
        attachments: data.attachments as Id<"_storage">[] | undefined,
        acknowledgementRequired: data.acknowledgementRequired,
      }
    );
  }

  static async updateAnnouncement(data: {
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
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)(
      (api as any).announcements.updateAnnouncement,
      {
        announcementId: data.announcementId as Id<"memos">,
        organizationId: data.organizationId as Id<"organizations">,
        title: data.title,
        content: data.content,
        priority: data.priority,
        targetAudience: data.targetAudience,
        departments: data.departments,
        specificEmployees: data.specificEmployees as
          | Id<"employees">[]
          | undefined,
        expiryDate: data.expiryDate,
        attachments: data.attachments as Id<"_storage">[] | undefined,
        acknowledgementRequired: data.acknowledgementRequired,
      }
    );
  }

  static async deleteAnnouncement(data: {
    announcementId: string;
    organizationId: string;
  }) {
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)(
      (api as any).announcements.deleteAnnouncement,
      {
        announcementId: data.announcementId as Id<"memos">,
        organizationId: data.organizationId as Id<"organizations">,
      }
    );
  }

  static async addReaction(data: {
    announcementId: string;
    organizationId: string;
    emoji: string;
  }) {
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)(
      (api as any).announcements.addReaction,
      {
        announcementId: data.announcementId as Id<"memos">,
        organizationId: data.organizationId as Id<"organizations">,
        emoji: data.emoji,
      }
    );
  }

  static async removeReaction(data: {
    announcementId: string;
    organizationId: string;
  }) {
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)(
      (api as any).announcements.removeReaction,
      {
        announcementId: data.announcementId as Id<"memos">,
        organizationId: data.organizationId as Id<"organizations">,
      }
    );
  }
}
