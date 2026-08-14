import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { getAuthedConvexClient } from "@/lib/convex-client";

export class ChatService {
  static async getUserByEmployeeId(data: {
    organizationId: string;
    employeeId: string;
  }) {
    const convex = await getAuthedConvexClient();
    return await convex.query(api.chat.getUserByEmployeeId, {
      organizationId: data.organizationId as Id<"organizations">,
      employeeId: data.employeeId as Id<"employees">,
    });
  }

  static async getOrCreateConversation(data: {
    organizationId: string;
    participantId: string;
    directThreadKind?: "standard" | "staff_as_admin";
  }) {
    const convex = await getAuthedConvexClient();
    return await convex.mutation(
      api.chat.getOrCreateConversation,
      {
        organizationId: data.organizationId as Id<"organizations">,
        participantId: data.participantId as Id<"users">,
        directThreadKind: data.directThreadKind,
      }
    );
  }

  static async sendMessage(data: {
    conversationId: string;
    content: string;
    messageType?: "text" | "image" | "file" | "system";
    attachments?: string[];
    payslipId?: string;
  }) {
    const convex = await getAuthedConvexClient();
    return await convex.mutation(api.chat.sendMessage, {
      conversationId: data.conversationId as Id<"conversations">,
      content: data.content,
      messageType: data.messageType || "text",
      attachments: data.attachments as Id<"_storage">[] | undefined,
      payslipId: data.payslipId as Id<"payslips"> | undefined,
    });
  }

  static async markMessagesAsRead(data: {
    conversationId: string;
    messageIds: string[];
  }) {
    const convex = await getAuthedConvexClient();
    return await convex.mutation(
      api.chat.markMessagesAsRead,
      {
        conversationId: data.conversationId as Id<"conversations">,
        messageIds: data.messageIds as Id<"messages">[],
      }
    );
  }

  static async sendMessageToEmployee(data: {
    organizationId: string;
    employeeId: string;
    content: string;
    messageType?: "text" | "image" | "file" | "system";
    attachments?: string[];
    payslipId?: string;
  }) {
    const employeeUser = await this.getUserByEmployeeId({
      organizationId: data.organizationId,
      employeeId: data.employeeId,
    });

    if (!employeeUser) {
      throw new Error("No user account found for this employee");
    }

    const conversationId = await this.getOrCreateConversation({
      organizationId: data.organizationId,
      participantId: employeeUser._id,
    });

    return await this.sendMessage({
      conversationId,
      content: data.content,
      messageType: data.messageType || "text",
      attachments: data.attachments,
      payslipId: data.payslipId,
    });
  }

  static async createGroupChat(data: {
    organizationId: string;
    name: string;
    participantIds: string[];
  }) {
    const convex = await getAuthedConvexClient();
    return await convex.mutation(api.chat.createGroupChat, {
      organizationId: data.organizationId as Id<"organizations">,
      name: data.name,
      participantIds: data.participantIds as Id<"users">[],
    });
  }

  static async addMembersToGroup(data: {
    conversationId: string;
    participantIds: string[];
  }) {
    const convex = await getAuthedConvexClient();
    return await convex.mutation(api.chat.addMembersToGroup, {
      conversationId: data.conversationId as Id<"conversations">,
      participantIds: data.participantIds as Id<"users">[],
    });
  }

  static async togglePinConversation(data: {
    organizationId: string;
    conversationId: string;
  }) {
    const convex = await getAuthedConvexClient();
    return await convex.mutation(
      api.chat.togglePinConversation,
      {
        organizationId: data.organizationId as Id<"organizations">,
        conversationId: data.conversationId as Id<"conversations">,
      }
    );
  }
}
