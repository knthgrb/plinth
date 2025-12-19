"use server";

import { ChatService } from "@/services/chat-service";

export async function getOrCreateConversation(data: {
  organizationId: string;
  participantId: string;
}) {
  return ChatService.getOrCreateConversation(data);
}

export async function sendMessage(data: {
  conversationId: string;
  content: string;
  messageType?: "text" | "image" | "file" | "system";
  attachments?: string[];
  payslipId?: string;
}) {
  return ChatService.sendMessage(data);
}

export async function markMessagesAsRead(data: {
  conversationId: string;
  messageIds: string[];
}) {
  return ChatService.markMessagesAsRead(data);
}

export async function sendMessageToEmployee(data: {
  organizationId: string;
  employeeId: string;
  content: string;
  messageType?: "text" | "image" | "file" | "system";
  attachments?: string[];
}) {
  return ChatService.sendMessageToEmployee(data);
}

export async function createGroupChat(data: {
  organizationId: string;
  name: string;
  participantIds: string[];
}) {
  return ChatService.createGroupChat(data);
}

export async function addMembersToGroup(data: {
  conversationId: string;
  participantIds: string[];
}) {
  return ChatService.addMembersToGroup(data);
}

export async function togglePinConversation(data: {
  organizationId: string;
  conversationId: string;
}) {
  return ChatService.togglePinConversation(data);
}
