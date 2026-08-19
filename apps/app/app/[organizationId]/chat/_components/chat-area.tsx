"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useMutation, useQuery } from "convex/react";
import { format } from "date-fns";
import {
  Archive,
  Bell,
  BellOff,
  CheckCheck,
  ChevronUp,
  FileText,
  Hash,
  Loader2,
  LogOut,
  MoreVertical,
  Paperclip,
  Receipt,
  Reply,
  Search,
  Send,
  Users,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { useOrganization } from "@/hooks/organization-context";
import {
  decryptWithSessionKeyB64,
  encryptWithSessionKeyB64,
  isEncryptedPayload,
} from "@/lib/chat-message-crypto";
import {
  directConversationAvatarInitials,
  directConversationSubtitle,
  directConversationTitle,
  messageSenderLabelInDirect,
} from "@/lib/chat-thread-display";
import { getIncomingMessageIdsToAcknowledge } from "@/lib/chat-read-state";
import type {
  ChatConversation,
  ChatMessage,
  ChatReaction,
  PendingChatParticipant,
} from "@/lib/chat/types";
import { errorMessage } from "@/lib/chat/types";
import { uploadFileToStorage } from "@/lib/storage-upload";
import { getOrganizationPath } from "@/utils/organization-routing";
import { validateChatFile } from "@/lib/chat-file-validation";
import { ChatFileAttachment } from "./chat-file-attachment";
import { useChatSessionKeys } from "./chat-session-keys-context";
import {
  ForwardMessageModal,
  type MessageToForward,
} from "./forward-message-modal";
import { CHAT_REACTIONS, MessageActions } from "./message-actions";
import { MessageListSkeleton } from "./skeletons";

type UploadingAttachment = {
  id: string;
  name: string;
  storageId?: Id<"_storage">;
  uploading: boolean;
  previewUrl?: string;
  contentType?: string;
};

type ChatAreaProps = {
  conversationId: string | null;
  conversation: ChatConversation | null;
  currentUserId?: string;
  pendingParticipant?: PendingChatParticipant;
  pendingAsAdmin?: boolean;
  onFirstMessageSent?: (conversationId: Id<"conversations">) => void;
  onAddMembers?: () => void;
  onCloseConversation?: () => void;
  onConversationUnavailable?: (conversationId: Id<"conversations">) => void;
};

function mergeMessages(
  existing: ChatMessage[],
  incoming: ChatMessage[],
): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const message of existing) byId.set(message._id, message);
  for (const message of incoming) byId.set(message._id, message);
  return [...byId.values()].sort((left, right) => left.createdAt - right.createdAt);
}

function groupReactions(reactions: ChatReaction[]) {
  const groups = new Map<string, ChatReaction[]>();
  for (const reaction of reactions) {
    groups.set(reaction.emoji, [...(groups.get(reaction.emoji) ?? []), reaction]);
  }
  return [...groups.entries()];
}

export function ChatArea({
  conversationId,
  conversation,
  currentUserId,
  pendingParticipant,
  pendingAsAdmin = false,
  onFirstMessageSent,
  onAddMembers,
  onCloseConversation,
  onConversationUnavailable,
}: ChatAreaProps) {
  const router = useRouter();
  const { toast } = useToast();
  const {
    currentOrganizationId,
    currentOrganization,
    effectiveOrganizationId,
  } = useOrganization();
  const sessionKeys = useChatSessionKeys();
  const messagesListRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [messageContent, setMessageContent] = useState("");
  const [attachments, setAttachments] = useState<UploadingAttachment[]>([]);
  const attachmentsRef = useRef<UploadingAttachment[]>([]);
  const [allMessages, setAllMessages] = useState<ChatMessage[]>([]);
  const [oldestTimestamp, setOldestTimestamp] = useState<number | null>(null);
  const [loadOlderBefore, setLoadOlderBefore] = useState<number | undefined>();
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [messageToForward, setMessageToForward] =
    useState<MessageToForward | null>(null);
  const [forwardModalOpen, setForwardModalOpen] = useState(false);
  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null);
  const [editContent, setEditContent] = useState("");
  const [deletingMessage, setDeletingMessage] = useState<ChatMessage | null>(null);
  const [conversationAction, setConversationAction] = useState<
    "leave" | "archive" | null
  >(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [messageSearch, setMessageSearch] = useState("");
  const scrollRestoreRef = useRef<{ height: number; top: number } | null>(null);
  const previousMessageCountRef = useRef(0);

  const messageQueryArgs = conversationId
    ? {
        conversationId: conversationId as Id<"conversations">,
        limit: 40,
        beforeTimestamp: loadOlderBefore,
      }
    : null;
  const messagesData = useQuery(
    api.chat.getMessages,
    messageQueryArgs ?? "skip",
  );
  const mutedConversationIds = useQuery(
    api.chat.getMutedConversationIds,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip",
  );
  const sendMessage = useMutation(api.chat.sendMessage);
  const createConversation = useMutation(api.chat.getOrCreateConversation);
  const markMessagesAsRead = useMutation(api.chat.markMessagesAsRead);
  const toggleMessageReaction = useMutation(api.chat.toggleMessageReaction);
  const editMessage = useMutation(api.chat.editMessage);
  const deleteMessage = useMutation(api.chat.deleteMessage);
  const leaveConversation = useMutation(api.chat.leaveConversation);
  const archiveConversation = useMutation(api.chat.archiveConversation);
  const setConversationMuted = useMutation(api.chat.setConversationMuted);

  useEffect(() => {
    if (!conversationId || !messagesData) return;
    const incoming = messagesData.messages.filter(
      (message) => message.conversationId === conversationId,
    ) as ChatMessage[];
    const frame = requestAnimationFrame(() => {
      setAllMessages((previous) =>
        loadOlderBefore
          ? mergeMessages(incoming, previous)
          : mergeMessages(previous, incoming),
      );
      if (incoming.length > 0) {
        setOldestTimestamp(
          Math.min(...incoming.map((message) => message.createdAt)),
        );
      }
      setIsLoadingOlder(false);
    });
    return () => cancelAnimationFrame(frame);
  }, [conversationId, loadOlderBefore, messagesData]);

  useEffect(() => {
    if (!conversationId || !currentUserId || allMessages.length === 0) return;
    const messageIds = getIncomingMessageIdsToAcknowledge(
      allMessages,
      currentUserId,
    );
    if (messageIds.length === 0) return;
    void markMessagesAsRead({
      conversationId: conversationId as Id<"conversations">,
      messageIds,
    });
  }, [allMessages, conversationId, currentUserId, markMessagesAsRead]);

  useLayoutEffect(() => {
    const list = messagesListRef.current;
    if (!list || allMessages.length === 0) return;
    if (scrollRestoreRef.current) {
      const previous = scrollRestoreRef.current;
      scrollRestoreRef.current = null;
      list.scrollTop = previous.top + list.scrollHeight - previous.height;
      previousMessageCountRef.current = allMessages.length;
      return;
    }
    if (allMessages.length > previousMessageCountRef.current) {
      list.scrollTop = list.scrollHeight;
    }
    previousMessageCountRef.current = allMessages.length;
  }, [allMessages]);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  useEffect(() => {
    return () => {
      for (const attachment of attachmentsRef.current) {
        if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
      }
    };
  }, []);

  const sessionKey = conversationId ? sessionKeys[conversationId] : undefined;
  const displayMessages = useMemo(() => {
    return allMessages.map((message) => {
      if (!sessionKey || message.deletedAt !== undefined) return message;
      const replyTo = message.replyTo
        ? {
            ...message.replyTo,
            content: isEncryptedPayload(message.replyTo.content)
              ? decryptWithSessionKeyB64(message.replyTo.content, sessionKey)
              : message.replyTo.content,
          }
        : null;
      return {
        ...message,
        content: decryptWithSessionKeyB64(message.content, sessionKey),
        replyTo,
      };
    });
  }, [allMessages, sessionKey]);

  const filteredMessages = useMemo(() => {
    const query = messageSearch.trim().toLowerCase();
    if (!query) return displayMessages;
    return displayMessages.filter((message) =>
      message.content.toLowerCase().includes(query),
    );
  }, [displayMessages, messageSearch]);

  const displayConversation = useMemo<ChatConversation | null>(() => {
    if (conversation) return conversation;
    if (!pendingParticipant || !currentOrganizationId) return null;
    return {
      _id: "pending" as Id<"conversations">,
      organizationId: currentOrganizationId,
      type: "direct",
      participants: [pendingParticipant],
      directThreadKind: pendingAsAdmin ? "staff_as_admin" : "standard",
      adminPersonaUserId:
        pendingAsAdmin && currentUserId
          ? (currentUserId as Id<"users">)
          : undefined,
      createdAt: 0,
      updatedAt: 0,
    };
  }, [conversation, currentOrganizationId, currentUserId, pendingAsAdmin, pendingParticipant]);

  const isMuted = Boolean(
    conversationId &&
      mutedConversationIds?.includes(conversationId as Id<"conversations">),
  );
  const role = currentOrganization?.role;
  const isElevated = role === "owner" || role === "admin" || role === "hr";
  const canArchive = Boolean(
    conversation &&
      conversation.type !== "direct" &&
      (isElevated || conversation.createdBy === currentUserId),
  );

  const clearAttachments = () => {
    setAttachments((previous) => {
      for (const attachment of previous) {
        if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
      }
      return [];
    });
  };

  const removeAttachment = (attachmentId: string) => {
    setAttachments((previous) => {
      const removed = previous.find((item) => item.id === attachmentId);
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      return previous.filter((item) => item.id !== attachmentId);
    });
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0 || !currentOrganizationId) return;
    setIsUploading(true);

    for (const file of files) {
      const validation = await validateChatFile(file);
      if (!validation.ok) {
        toast({
          title: "Unsupported attachment",
          description: `${file.name}: ${validation.reason}`,
          variant: "destructive",
        });
        continue;
      }

      const id = `${Date.now()}-${crypto.randomUUID()}`;
      const previewUrl = file.type.startsWith("image/")
        ? URL.createObjectURL(file)
        : undefined;
      setAttachments((previous) => [
        ...previous,
        {
          id,
          name: file.name,
          uploading: true,
          previewUrl,
          contentType: file.type,
        },
      ]);
      try {
        const storageId = (await uploadFileToStorage({
          organizationId: currentOrganizationId,
          purpose: "chat_attachment",
          file,
        })) as Id<"_storage">;
        setAttachments((previous) =>
          previous.map((attachment) =>
            attachment.id === id
              ? { ...attachment, storageId, uploading: false }
              : attachment,
          ),
        );
      } catch (error: unknown) {
        setAttachments((previous) =>
          previous.filter((attachment) => attachment.id !== id),
        );
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        toast({
          title: "Upload failed",
          description: errorMessage(error, `Could not upload ${file.name}.`),
          variant: "destructive",
        });
      }
    }

    setIsUploading(false);
    event.target.value = "";
  };

  const handleSendMessage = async (event: React.FormEvent) => {
    event.preventDefault();
    const uploaded = attachments.filter(
      (attachment): attachment is UploadingAttachment & { storageId: Id<"_storage"> } =>
        !attachment.uploading && attachment.storageId !== undefined,
    );
    if (
      (!messageContent.trim() && uploaded.length === 0) ||
      attachments.some((attachment) => attachment.uploading) ||
      (!conversationId && !pendingParticipant) ||
      !currentOrganizationId
    ) {
      return;
    }

    try {
      let targetConversationId = conversationId as Id<"conversations"> | null;
      if (!targetConversationId && pendingParticipant) {
        targetConversationId = await createConversation({
          organizationId: currentOrganizationId,
          participantId: pendingParticipant._id,
          directThreadKind: pendingAsAdmin ? "staff_as_admin" : "standard",
        });
        onFirstMessageSent?.(targetConversationId);
      }
      if (!targetConversationId) return;

      const plainContent =
        messageContent.trim() || (uploaded.length > 0 ? "Attached file" : "");
      const targetSessionKey = sessionKeys[targetConversationId];
      const content = targetSessionKey
        ? encryptWithSessionKeyB64(plainContent, targetSessionKey)
        : plainContent;
      await sendMessage({
        conversationId: targetConversationId,
        content,
        messageType: uploaded.length > 0 ? "file" : "text",
        attachments:
          uploaded.length > 0
            ? uploaded.map((attachment) => attachment.storageId)
            : undefined,
        replyToMessageId: replyingTo?._id,
      });
      setMessageContent("");
      setReplyingTo(null);
      clearAttachments();
    } catch (error: unknown) {
      toast({
        title: "Message not sent",
        description: errorMessage(error, "Please try again."),
        variant: "destructive",
      });
    }
  };

  const handleReaction = async (
    message: ChatMessage,
    emoji: (typeof CHAT_REACTIONS)[number],
  ) => {
    if (!currentUserId) return;
    const userId = currentUserId as Id<"users">;
    const previousReactions = message.reactions;
    const existing = previousReactions.find(
      (reaction) => reaction.userId === userId && reaction.emoji === emoji,
    );
    const optimisticReactions = existing
      ? previousReactions.filter((reaction) => reaction._id !== existing._id)
      : [
          ...previousReactions,
          {
            _id: `${message._id}:${userId}:${emoji}` as Id<"messageReactions">,
            userId,
            emoji,
            createdAt: 0,
          },
        ];
    setAllMessages((previous) =>
      previous.map((item) =>
        item._id === message._id
          ? { ...item, reactions: optimisticReactions }
          : item,
      ),
    );
    try {
      await toggleMessageReaction({ messageId: message._id, emoji });
    } catch (error: unknown) {
      setAllMessages((previous) =>
        previous.map((item) =>
          item._id === message._id
            ? { ...item, reactions: previousReactions }
            : item,
        ),
      );
      toast({
        title: "Reaction not saved",
        description: errorMessage(error, "Your previous reaction was restored."),
        variant: "destructive",
      });
    }
  };

  const handleEdit = async () => {
    if (!editingMessage || !editContent.trim()) return;
    try {
      const content = sessionKey
        ? encryptWithSessionKeyB64(editContent.trim(), sessionKey)
        : editContent.trim();
      await editMessage({ messageId: editingMessage._id, content });
      setEditingMessage(null);
      setEditContent("");
    } catch (error: unknown) {
      toast({
        title: "Message not updated",
        description: errorMessage(error, "Please try again."),
        variant: "destructive",
      });
    }
  };

  const handleDelete = async () => {
    if (!deletingMessage) return;
    try {
      await deleteMessage({ messageId: deletingMessage._id });
      setDeletingMessage(null);
    } catch (error: unknown) {
      toast({
        title: "Message not removed",
        description: errorMessage(error, "Please try again."),
        variant: "destructive",
      });
    }
  };

  const handleConversationAction = async () => {
    if (!conversationId || !conversationAction) return;
    const id = conversationId as Id<"conversations">;
    try {
      if (conversationAction === "leave") {
        await leaveConversation({ conversationId: id });
      } else {
        await archiveConversation({ conversationId: id });
      }
      setConversationAction(null);
      onConversationUnavailable?.(id);
    } catch (error: unknown) {
      toast({
        title: conversationAction === "leave" ? "Could not leave" : "Could not archive",
        description: errorMessage(error, "Please try again."),
        variant: "destructive",
      });
    }
  };

  const handleMuteChange = async () => {
    if (!conversationId) return;
    try {
      await setConversationMuted({
        conversationId: conversationId as Id<"conversations">,
        muted: !isMuted,
      });
    } catch (error: unknown) {
      toast({
        title: isMuted ? "Could not unmute" : "Could not mute",
        description: errorMessage(error, "Please try again."),
        variant: "destructive",
      });
    }
  };

  if (!displayConversation) {
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-background">
        <div className="h-16 border-b border-gray-200 bg-white" />
        <div className="flex flex-1 items-center justify-center p-8">
          <div className="max-w-sm text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-purple/10 text-brand-purple">
              <Send className="h-6 w-6" />
            </div>
            <h2 className="text-lg font-semibold">Your organization conversations</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Select a conversation or start a new one to communicate with your team.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const headerTitle =
    displayConversation.type === "channel"
      ? displayConversation.name ?? "Channel"
      : directConversationTitle(displayConversation, currentUserId);
  const headerSubtitle =
    displayConversation.type === "channel"
      ? "Official organization channel"
      : displayConversation.type === "group"
        ? `${displayConversation.participants.length} members`
        : directConversationSubtitle(displayConversation, currentUserId);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <header className="flex h-16 shrink-0 items-center gap-3 border-b border-gray-200 bg-white px-4">
        <Avatar className="h-9 w-9">
          <AvatarFallback className="bg-brand-purple/10 text-brand-purple">
            {displayConversation.type === "channel" ? (
              <Hash className="h-4 w-4" />
            ) : displayConversation.type === "group" ? (
              <Users className="h-4 w-4" />
            ) : (
              directConversationAvatarInitials(displayConversation, currentUserId)
            )}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold">
            {displayConversation.type === "channel" ? "# " : ""}
            {headerTitle}
          </h1>
          <p className="truncate text-xs text-muted-foreground">{headerSubtitle}</p>
        </div>
        {searchOpen && conversationId && (
          <div className="hidden w-64 items-center gap-2 md:flex">
            <Input
              value={messageSearch}
              onChange={(event) => setMessageSearch(event.target.value)}
              placeholder="Search loaded messages"
              className="h-9"
              autoFocus
            />
            <span className="whitespace-nowrap text-xs text-muted-foreground">
              {filteredMessages.length} found
            </span>
          </div>
        )}
        {conversationId && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => {
              setSearchOpen((open) => !open);
              if (searchOpen) setMessageSearch("");
            }}
            aria-label="Search messages"
          >
            <Search className="h-4 w-4" />
          </Button>
        )}
        {(displayConversation.type === "group" ||
          displayConversation.type === "channel") && (
          <Popover>
            <PopoverTrigger asChild>
              <Button type="button" variant="ghost" size="sm">
                <Users className="mr-1.5 h-4 w-4" />
                {displayConversation.participants.length}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 p-2">
              <p className="border-b border-gray-200 px-2 pb-2 text-sm font-semibold">Members</p>
              <div className="max-h-64 overflow-y-auto py-1">
                {displayConversation.participants.map((participant) => (
                  <div key={participant._id} className="flex items-center gap-2 rounded-lg p-2">
                    <Avatar className="h-8 w-8">
                      <AvatarFallback className="text-xs">
                        {(participant.name ?? participant.email).slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {participant.name ?? participant.email}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {participant.email}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        )}
        {conversationId && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon" aria-label="Conversation actions">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {onAddMembers && (
                <DropdownMenuItem onClick={onAddMembers}>
                  <Users className="mr-2 h-4 w-4" />
                  Add members
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onClick={() => void handleMuteChange()}
              >
                {isMuted ? (
                  <Bell className="mr-2 h-4 w-4" />
                ) : (
                  <BellOff className="mr-2 h-4 w-4" />
                )}
                {isMuted ? "Unmute conversation" : "Mute conversation"}
              </DropdownMenuItem>
              {displayConversation.type !== "direct" && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setConversationAction("leave")}>
                    <LogOut className="mr-2 h-4 w-4" />
                    Leave conversation
                  </DropdownMenuItem>
                  {canArchive && (
                    <DropdownMenuItem
                      onClick={() => setConversationAction("archive")}
                      className="text-destructive focus:text-destructive"
                    >
                      <Archive className="mr-2 h-4 w-4" />
                      Archive conversation
                    </DropdownMenuItem>
                  )}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {onCloseConversation && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onCloseConversation}
            aria-label="Close conversation"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </header>

      {searchOpen && conversationId && (
        <div className="flex items-center gap-2 border-b border-gray-200 bg-white p-2 md:hidden">
          <Input
            value={messageSearch}
            onChange={(event) => setMessageSearch(event.target.value)}
            placeholder="Search loaded messages"
            className="h-9"
            autoFocus
          />
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            {filteredMessages.length} found
          </span>
        </div>
      )}

      <div ref={messagesListRef} className="min-h-0 flex-1 overflow-y-auto bg-muted/20 px-3 py-5 sm:px-6">
        {conversationId && messagesData?.hasMore && (
          <div className="mb-5 flex justify-center">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isLoadingOlder}
              onClick={() => {
                const list = messagesListRef.current;
                if (list) {
                  scrollRestoreRef.current = {
                    height: list.scrollHeight,
                    top: list.scrollTop,
                  };
                }
                setIsLoadingOlder(true);
                setLoadOlderBefore(oldestTimestamp ?? undefined);
              }}
            >
              {isLoadingOlder ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <ChevronUp className="mr-2 h-4 w-4" />
              )}
              Earlier messages
            </Button>
          </div>
        )}
        {conversationId && messagesData === undefined && allMessages.length === 0 ? (
          <MessageListSkeleton />
        ) : filteredMessages.length === 0 ? (
          <div className="flex h-full min-h-64 items-center justify-center text-center">
            <div>
              <p className="text-sm font-medium">
                {messageSearch ? "No matching messages" : "No messages yet"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {messageSearch
                  ? "Try another phrase. Search covers loaded messages."
                  : "Send the first message to begin this conversation."}
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredMessages.map((message) => {
              const isOwn = message.senderId === currentUserId;
              const senderLabel = messageSenderLabelInDirect(
                message.senderId,
                message.sender,
                displayConversation,
                currentUserId,
              );
              const canEdit =
                isOwn &&
                message.deletedAt === undefined;
              const canDelete =
                message.deletedAt === undefined && (isOwn || isElevated);
              return (
                <article
                  key={message._id}
                  className={`group flex gap-2 ${isOwn ? "justify-end" : "justify-start"}`}
                >
                  {!isOwn && (
                    <Avatar className="mt-5 h-8 w-8 shrink-0">
                      <AvatarFallback className="text-xs">
                        {senderLabel.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                  )}
                  <div className={`min-w-0 max-w-[82%] sm:max-w-[70%] ${isOwn ? "items-end" : "items-start"} flex flex-col`}>
                    <div className="mb-1 flex items-center gap-2 px-1">
                      {!isOwn && <span className="text-xs font-medium">{senderLabel}</span>}
                      <span className="text-[11px] text-muted-foreground">
                        {format(new Date(message.createdAt), "MMM d, h:mm a")}
                      </span>
                      {message.editedAt && message.deletedAt === undefined && (
                        <span className="text-[11px] text-muted-foreground">edited</span>
                      )}
                    </div>
                    <div className="relative">
                      {message.deletedAt === undefined && (
                        <div className={`absolute top-0 z-10 hidden -translate-y-[calc(100%+4px)] group-hover:block ${isOwn ? "right-0" : "left-0"}`}>
                          <MessageActions
                            canEdit={canEdit}
                            canDelete={canDelete}
                            canForward={!message.payslipId}
                            onReply={() => setReplyingTo(message)}
                            onReact={(emoji) => void handleReaction(message, emoji)}
                            onEdit={() => {
                              setEditingMessage(message);
                              setEditContent(message.content);
                            }}
                            onDelete={() => setDeletingMessage(message)}
                            onForward={() => {
                              setMessageToForward({ messageId: message._id });
                              setForwardModalOpen(true);
                            }}
                          />
                        </div>
                      )}
                      <div
                        className={`rounded-2xl px-3.5 py-2.5 shadow-sm ${
                          message.deletedAt !== undefined
                            ? "border border-gray-200 bg-white text-muted-foreground"
                            : isOwn
                              ? "bg-brand-purple text-white"
                              : "border border-gray-200 bg-white text-foreground"
                        }`}
                      >
                        {message.replyTo && message.deletedAt === undefined && (
                          <div className={`mb-2 rounded-lg border-l-2 px-2 py-1 text-xs ${isOwn ? "border-white/50 bg-white/10" : "border-brand-purple/50 bg-muted"}`}>
                            <p className="font-medium">{message.replyTo.senderName}</p>
                            <p className="truncate opacity-80">{message.replyTo.content}</p>
                          </div>
                        )}
                        {message.deletedAt !== undefined ? (
                          <p className="text-sm italic">
                            {message.deletionKind === "moderator"
                              ? "Message removed by a moderator"
                              : "Message removed"}
                          </p>
                        ) : (
                          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                            {message.content}
                          </p>
                        )}
                        {message.deletedAt === undefined && message.attachments.length > 0 && conversationId && (
                          <div className="mt-2 space-y-2">
                            {message.attachments.map((storageId) => (
                              <ChatFileAttachment
                                key={storageId}
                                conversationId={conversationId as Id<"conversations">}
                                messageId={message._id}
                                storageId={storageId}
                                isOwnMessage={isOwn}
                              />
                            ))}
                          </div>
                        )}
                        {message.deletedAt === undefined && message.payslipId && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="mt-2 bg-background text-foreground"
                            onClick={() => {
                              const organizationId = effectiveOrganizationId ?? currentOrganizationId;
                              if (!organizationId) return;
                              const route = role === "employee" ? "payslips" : "payroll";
                              router.push(
                                getOrganizationPath(
                                  organizationId,
                                  `${route}?payslipId=${message.payslipId}`,
                                ),
                              );
                            }}
                          >
                            <Receipt className="mr-1.5 h-3.5 w-3.5" />
                            View payslip
                          </Button>
                        )}
                      </div>
                    </div>
                    {message.deletedAt === undefined && message.reactions.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1 px-1">
                        {groupReactions(message.reactions).map(([emoji, reactions]) => {
                          const reacted = reactions.some(
                            (reaction) => reaction.userId === currentUserId,
                          );
                          return (
                            <button
                              key={emoji}
                              type="button"
                              onClick={() =>
                                void handleReaction(
                                  message,
                                  emoji as (typeof CHAT_REACTIONS)[number],
                                )
                              }
                              className={`rounded-full border px-2 py-0.5 text-xs transition-colors ${reacted ? "border-brand-purple bg-brand-purple/10" : "border-gray-200 bg-white hover:bg-gray-50"}`}
                            >
                              {emoji} {reactions.length}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {isOwn && message.readBy.length > 1 && (
                      <span className="mt-1 flex items-center gap-1 px-1 text-[11px] text-muted-foreground">
                        <CheckCheck className="h-3 w-3" /> Read
                      </span>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      <footer className="shrink-0 border-t border-gray-200 bg-white p-3 sm:p-4">
        {replyingTo && (
          <div className="mb-2 flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
            <Reply className="h-4 w-4 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium">Replying to {messageSenderLabelInDirect(replyingTo.senderId, replyingTo.sender, displayConversation, currentUserId)}</p>
              <p className="truncate text-xs text-muted-foreground">{replyingTo.content}</p>
            </div>
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => setReplyingTo(null)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}
        {attachments.length > 0 && (
          <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
            {attachments.map((attachment) => (
              <div key={attachment.id} className="relative flex h-20 w-28 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-gray-200 bg-gray-50">
                {attachment.previewUrl ? (
                  <Image
                    src={attachment.previewUrl}
                    alt={attachment.name}
                    fill
                    unoptimized
                    className="object-cover"
                  />
                ) : (
                  <div className="min-w-0 p-2 text-center">
                    {attachment.uploading ? (
                      <Loader2 className="mx-auto mb-1 h-5 w-5 animate-spin" />
                    ) : (
                      <FileText className="mx-auto mb-1 h-5 w-5" />
                    )}
                    <p className="truncate text-xs">{attachment.name}</p>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => removeAttachment(attachment.id)}
                  className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white"
                  aria-label="Remove attachment"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <form onSubmit={handleSendMessage} className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => void handleFileSelect(event)}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-11 w-11 shrink-0 rounded-xl border-gray-200 shadow-none"
            disabled={isUploading}
            onClick={() => fileInputRef.current?.click()}
            aria-label="Attach files"
          >
            {isUploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Paperclip className="h-4 w-4" />
            )}
          </Button>
          <Textarea
            value={messageContent}
            onChange={(event) => setMessageContent(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }}
            placeholder="Write a message"
            aria-label="Message"
            rows={1}
            maxLength={5000}
            className="max-h-40 min-h-11 flex-1 resize-none rounded-xl border-gray-200 py-2.5 shadow-none"
          />
          <Button
            type="submit"
            size="icon"
            className="h-11 w-11 shrink-0 rounded-xl bg-brand-purple hover:bg-brand-purple/90"
            disabled={
              (!messageContent.trim() && attachments.length === 0) ||
              attachments.some((attachment) => attachment.uploading)
            }
            aria-label="Send message"
          >
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </footer>

      <Dialog open={editingMessage !== null} onOpenChange={(open) => !open && setEditingMessage(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit message</DialogTitle>
            <DialogDescription>Messages can be edited for 15 minutes after sending.</DialogDescription>
          </DialogHeader>
          <Textarea value={editContent} onChange={(event) => setEditContent(event.target.value)} rows={5} maxLength={5000} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingMessage(null)}>Cancel</Button>
            <Button onClick={() => void handleEdit()} disabled={!editContent.trim()}>Save changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deletingMessage !== null} onOpenChange={(open) => !open && setDeletingMessage(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Remove message?</DialogTitle>
            <DialogDescription>The content will be replaced with an attributed deletion record.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingMessage(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => void handleDelete()}>Remove message</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={conversationAction !== null} onOpenChange={(open) => !open && setConversationAction(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{conversationAction === "archive" ? "Archive conversation?" : "Leave conversation?"}</DialogTitle>
            <DialogDescription>
              {conversationAction === "archive"
                ? "The conversation becomes read-only and disappears from active chat lists. Its history is retained."
                : "The conversation and its history remain available to the other members."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConversationAction(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => void handleConversationAction()}>
              {conversationAction === "archive" ? "Archive" : "Leave"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ForwardMessageModal
        isOpen={forwardModalOpen}
        onOpenChange={(open) => {
          setForwardModalOpen(open);
          if (!open) setMessageToForward(null);
        }}
        message={messageToForward}
        currentConversationId={conversationId}
        currentUserId={currentUserId}
      />
    </div>
  );
}
