import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { getAuthedConvexClient } from "@/lib/convex-client";

export class ChatService {
  static async getUserByEmployeeId(data: {
    organizationId: string;
    employeeId: string;
  }) {
    const convex = await getAuthedConvexClient();
    return await (convex.query as any)((api as any).chat.getUserByEmployeeId, {
      organizationId: data.organizationId as Id<"organizations">,
      employeeId: data.employeeId as Id<"employees">,
    });
  }

  static async getOrCreateConversation(data: {
    organizationId: string;
    participantId: string;
  }) {
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)(
      (api as any).chat.getOrCreateConversation,
      {
        organizationId: data.organizationId as Id<"organizations">,
        participantId: data.participantId as Id<"users">,
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
    return await (convex.mutation as any)((api as any).chat.sendMessage, {
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
    return await (convex.mutation as any)(
      (api as any).chat.markMessagesAsRead,
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
  }) {
    const convex = await getAuthedConvexClient();

    // Get user associated with employee ID
    const employeeUser = await this.getUserByEmployeeId({
      organizationId: data.organizationId,
      employeeId: data.employeeId,
    });

    if (!employeeUser) {
      throw new Error("No user account found for this employee");
    }

    // Get or create conversation
    const conversationId = await this.getOrCreateConversation({
      organizationId: data.organizationId,
      participantId: employeeUser._id,
    });

    // Send message
    return await this.sendMessage({
      conversationId,
      content: data.content,
      messageType: data.messageType || "text",
      attachments: data.attachments,
    });
  }

  static async createGroupChat(data: {
    organizationId: string;
    name: string;
    participantIds: string[];
  }) {
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)((api as any).chat.createGroupChat, {
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
    return await (convex.mutation as any)((api as any).chat.addMembersToGroup, {
      conversationId: data.conversationId as Id<"conversations">,
      participantIds: data.participantIds as Id<"users">[],
    });
  }

  static async togglePinConversation(data: {
    organizationId: string;
    conversationId: string;
  }) {
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)(
      (api as any).chat.togglePinConversation,
      {
        organizationId: data.organizationId as Id<"organizations">,
        conversationId: data.conversationId as Id<"conversations">,
      }
    );
  }
}
