import type { Id } from "@/convex/_generated/dataModel";

export type ChatRole =
  | "owner"
  | "admin"
  | "hr"
  | "manager"
  | "accounting"
  | "employee";

export type ChatUser = {
  _id: Id<"users">;
  name?: string;
  email: string;
  role?: ChatRole;
};

export type ChatReaction = {
  _id: Id<"messageReactions">;
  userId: Id<"users">;
  emoji: string;
  createdAt: number;
};

export type ChatMessage = {
  _id: Id<"messages">;
  conversationId: Id<"conversations">;
  senderId: Id<"users">;
  content: string;
  messageType: "text" | "image" | "file" | "system";
  attachments: Id<"_storage">[];
  readBy: Id<"users">[];
  reactions: ChatReaction[];
  payslipId?: Id<"payslips">;
  replyToMessageId?: Id<"messages">;
  replyTo: {
    _id: Id<"messages">;
    content: string;
    senderName: string;
  } | null;
  sender: ChatUser | null;
  editedAt?: number;
  deletedAt?: number;
  deletedBy?: Id<"users">;
  deletionKind?: "author" | "moderator";
  createdAt: number;
};

export type ChatConversation = {
  _id: Id<"conversations">;
  organizationId: Id<"organizations">;
  type: "direct" | "group" | "channel";
  name?: string;
  createdBy?: Id<"users">;
  channelScope?: "organization" | "personal";
  directThreadKind?: "standard" | "staff_as_admin";
  adminPersonaUserId?: Id<"users">;
  participants: ChatUser[];
  lastMessage?: {
    _id: Id<"messages">;
    senderId: Id<"users">;
    content: string;
    messageType: "text" | "image" | "file" | "system";
    deletedAt?: number;
    createdAt: number;
  } | null;
  lastMessageAt?: number;
  archivedAt?: number;
  archivedBy?: Id<"users">;
  createdAt: number;
  updatedAt: number;
};

export type ChatChannel = {
  _id: Id<"conversations">;
  name?: string;
  channelScope?: "organization" | "personal";
  createdBy?: Id<"users">;
  participantCount: number;
  joined: boolean;
  lastMessageAt?: number;
  createdAt: number;
};

export type PendingChatParticipant = Pick<ChatUser, "_id" | "name" | "email">;

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
