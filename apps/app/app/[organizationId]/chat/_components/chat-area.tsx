"use client";

import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Send,
  Receipt,
  Users,
  MoreVertical,
  Paperclip,
  X,
  FileText,
  Download,
  ChevronUp,
  Forward,
  Reply,
  Smile,
  Trash2,
} from "lucide-react";
import { format } from "date-fns";
import { Id } from "@/convex/_generated/dataModel";
import { useRouter } from "next/navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { chatCache } from "@/services/chat-cache-service";
import { generateUploadUrl } from "@/actions/files";
import { validateChatFile } from "@/lib/chat-file-validation";
import { DocumentSelectorModal } from "./document-selector-modal";
import {
  ForwardMessageModal,
  type MessageToForward,
} from "./forward-message-modal";
import { MessageSkeleton, MessageListSkeleton } from "./skeletons";
import { useToast } from "@/components/ui/use-toast";
import { useOrganization } from "@/hooks/organization-context";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ChatAreaProps {
  conversationId: string | null;
  conversation: any;
  currentUserId?: string;
  /** When starting a new DM, conversation is created on first message send. */
  pendingParticipant?: { _id: string; name?: string; email?: string };
  onFirstMessageSent?: (conversationId: string) => void;
  onAddMembers?: () => void;
  /** Close the current conversation (clear selection). */
  onCloseConversation?: () => void;
  /** Called after conversation is deleted (e.g. to clear selection). */
  onDeleteConversation?: (conversationId: Id<"conversations">) => void;
}

export function ChatArea({
  conversationId,
  conversation,
  currentUserId,
  pendingParticipant,
  onFirstMessageSent,
  onAddMembers,
  onCloseConversation,
  onDeleteConversation,
}: ChatAreaProps) {
  const router = useRouter();
  const { toast } = useToast();
  const { currentOrganizationId } = useOrganization();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesTopRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [messageContent, setMessageContent] = useState("");
  const [attachments, setAttachments] = useState<
    Array<{
      id: string;
      name: string;
      storageId?: string;
      uploading?: boolean;
      previewUrl?: string;
      contentType?: string;
    }>
  >([]);
  const [isDocumentModalOpen, setIsDocumentModalOpen] = useState(false);
  const [forwardModalOpen, setForwardModalOpen] = useState(false);
  const [messageToForward, setMessageToForward] =
    useState<MessageToForward | null>(null);
  const [replyingTo, setReplyingTo] = useState<{
    messageId: string;
    contentSnippet: string;
    senderName: string;
  } | null>(null);
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null);
  const hoverLeaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const [isUploading, setIsUploading] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [allMessages, setAllMessages] = useState<any[]>([]);
  const [oldestTimestamp, setOldestTimestamp] = useState<number | null>(null);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);

  const [loadOlderTrigger, setLoadOlderTrigger] = useState(0);

  const messagesData = useQuery(
    (api as any).chat.getMessages,
    conversationId
      ? {
          conversationId: conversationId as Id<"conversations">,
          limit: 25,
          beforeTimestamp: loadOlderTrigger > 0 ? oldestTimestamp : undefined,
        }
      : "skip",
  );

  // Track if we're loading older messages
  const isLoadingOlderRef = useRef(false);

  // Update messages when data changes
  useEffect(() => {
    if (messagesData) {
      if (isLoadingOlderRef.current) {
        // Loading older messages - prepend them
        setAllMessages((prev) => {
          const newMessages = messagesData.messages.filter(
            (newMsg: any) =>
              !prev.some((oldMsg: any) => oldMsg._id === newMsg._id),
          );
          return [...newMessages, ...prev];
        });
        // Update oldest timestamp to the new oldest message
        if (messagesData.oldestTimestamp) {
          setOldestTimestamp(messagesData.oldestTimestamp);
        }
      } else {
        // Initial load
        setAllMessages(messagesData.messages);
        if (messagesData.oldestTimestamp) {
          setOldestTimestamp(messagesData.oldestTimestamp);
        }
      }
      setIsLoadingOlder(false);
      isLoadingOlderRef.current = false;
    }
  }, [messagesData]);

  // Reset when conversation changes
  useEffect(() => {
    setAllMessages([]);
    setOldestTimestamp(null);
    setIsLoadingOlder(false);
    isLoadingOlderRef.current = false;
    setLoadOlderTrigger(0);
    setReplyingTo(null);
    setHoveredMessageId(null);
  }, [conversationId]);

  // Clear hover leave timeout on unmount
  useEffect(() => {
    return () => {
      if (hoverLeaveTimeoutRef.current)
        clearTimeout(hoverLeaveTimeoutRef.current);
    };
  }, []);

  const messages = allMessages;
  const hasMoreMessages = messagesData?.hasMore || false;

  const sendMessageMutation = useMutation((api as any).chat.sendMessage);
  const getOrCreateConversationMutation = useMutation(
    (api as any).chat.getOrCreateConversation,
  );
  const markMessagesAsReadMutation = useMutation(
    (api as any).chat.markMessagesAsRead,
  );
  const deleteConversationMutation = useMutation(
    (api as any).chat.deleteConversation,
  );

  // Mark messages as read when viewing this conversation
  useEffect(() => {
    if (
      !conversationId ||
      !currentUserId ||
      !allMessages.length
    )
      return;
    const unreadIds = allMessages
      .filter(
        (m: any) =>
          m.senderId !== currentUserId &&
          !(m.readBy || []).includes(currentUserId),
      )
      .map((m: any) => m._id);
    if (unreadIds.length === 0) return;
    markMessagesAsReadMutation({
      conversationId: conversationId as Id<"conversations">,
      messageIds: unreadIds,
    }).catch((err) => console.error("markMessagesAsRead failed", err));
  }, [conversationId, currentUserId, allMessages]);

  // Cache messages when they update
  useEffect(() => {
    if (messages && conversationId) {
      chatCache.cacheMessages(conversationId, messages).catch((error) => {
        console.error("Error caching messages:", error);
      });
    }
  }, [messages, conversationId]);

  const loadOlderMessages = () => {
    if (!hasMoreMessages || isLoadingOlder || !oldestTimestamp) return;
    setIsLoadingOlder(true);
    isLoadingOlderRef.current = true;
    // Trigger query with current oldestTimestamp to fetch older messages
    setLoadOlderTrigger((prev) => prev + 1);
  };

  // Auto-scroll to bottom when new messages arrive (only on initial load or new messages)
  useEffect(() => {
    if (!oldestTimestamp) {
      // Initial load - scroll to bottom
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages.length, oldestTimestamp]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const toUpload: File[] = [];
    for (const file of Array.from(files)) {
      const result = await validateChatFile(file);
      if (!result.ok) {
        toast({
          title: "Invalid file",
          description: `${file.name}: ${result.reason}`,
          variant: "destructive",
        });
        continue;
      }
      toUpload.push(file);
    }

    if (toUpload.length === 0) {
      e.target.value = "";
      return;
    }

    setIsUploading(true);

    for (const file of toUpload) {
      const fileId = `file-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const isImage = file.type.startsWith("image/");
      const isVideo = file.type.startsWith("video/");
      const previewUrl =
        isImage || isVideo ? URL.createObjectURL(file) : undefined;
      const contentType = isImage || isVideo ? file.type : undefined;
      setAttachments((prev) => [
        ...prev,
        {
          id: fileId,
          name: file.name,
          uploading: true,
          previewUrl,
          contentType,
        },
      ]);

      try {
        const uploadUrl = await generateUploadUrl();
        const result = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": file.type },
          body: file,
        });

        if (!result.ok) {
          throw new Error(`Failed to upload ${file.name}`);
        }

        const responseText = await result.text();
        let storageId: string;
        try {
          const jsonResponse = JSON.parse(responseText);
          storageId = jsonResponse.storageId || jsonResponse;
        } catch {
          storageId = responseText;
        }
        storageId = storageId.trim().replace(/^["']|["']$/g, "");

        setAttachments((prev) =>
          prev.map((att) =>
            att.id === fileId ? { ...att, storageId, uploading: false } : att,
          ),
        );
      } catch (error: any) {
        console.error(`Error uploading ${file.name}:`, error);
        setAttachments((prev) => prev.filter((att) => att.id !== fileId));
        toast({
          title: "Upload failed",
          description: error.message || `Failed to upload ${file.name}`,
          variant: "destructive",
        });
      }
    }

    setIsUploading(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleRemoveAttachment = (id: string) => {
    setAttachments((prev) => {
      const att = prev.find((a) => a.id === id);
      if (att?.previewUrl) URL.revokeObjectURL(att.previewUrl);
      return prev.filter((att) => att.id !== id);
    });
  };

  const handleSelectDocuments = (storageIds: string[]) => {
    const newAttachments = storageIds.map((storageId, index) => ({
      id: `doc-${Date.now()}-${index}`,
      name: `Document ${index + 1}`,
      storageId,
      uploading: false,
    }));
    setAttachments((prev) => [...prev, ...newAttachments]);
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const hasContent = messageContent.trim() || attachments.length > 0;
    if (!hasContent || (!conversationId && !pendingParticipant)) return;

    const pendingAttachments = attachments.filter(
      (att) => att.uploading || !att.storageId,
    );
    if (pendingAttachments.length > 0) {
      toast({
        title: "Please wait",
        description: "Wait for all files to finish uploading",
        variant: "destructive",
      });
      return;
    }

    const attachmentStorageIds = attachments
      .filter((att) => att.storageId)
      .map((att) => att.storageId!);
    const content =
      messageContent.trim() ||
      (attachmentStorageIds.length > 0 ? "📎 File(s)" : "");

    try {
      let targetConversationId = conversationId;
      if (pendingParticipant && !conversationId && currentOrganizationId) {
        const newConversationId = await getOrCreateConversationMutation({
          organizationId: currentOrganizationId as Id<"organizations">,
          participantId: pendingParticipant._id as Id<"users">,
        });
        targetConversationId = newConversationId;
        onFirstMessageSent?.(newConversationId);
      }
      if (!targetConversationId) return;

      await sendMessageMutation({
        conversationId: targetConversationId as Id<"conversations">,
        content,
        messageType: attachmentStorageIds.length > 0 ? "file" : "text",
        attachments:
          attachmentStorageIds.length > 0
            ? attachmentStorageIds.map((id) => id as Id<"_storage">)
            : undefined,
        replyToMessageId: replyingTo
          ? (replyingTo.messageId as Id<"messages">)
          : undefined,
      });
      setAttachments((prev) => {
        prev.forEach((att) => {
          if (att.previewUrl) URL.revokeObjectURL(att.previewUrl);
        });
        return [];
      });
      setMessageContent("");
      setReplyingTo(null);
    } catch (error: any) {
      console.error("Error sending message:", error);
      toast({
        title: "Failed to send",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    }
  };

  const displayConversation =
    conversation ||
    (pendingParticipant
      ? { type: "direct" as const, participants: [pendingParticipant] }
      : null);

  const getDisplayName = () => {
    if (!displayConversation) return "";
    if (displayConversation.type === "channel")
      return `# ${displayConversation.name || "Channel"}`;
    if (displayConversation.type === "group")
      return displayConversation.name || "Group Chat";
    // Direct: participants include current user; show the other participant
    const otherParticipant = displayConversation.participants?.find(
      (p: any) => p._id !== currentUserId
    );
    return otherParticipant?.name || otherParticipant?.email || "Unknown User";
  };

  const getInitials = () => {
    if (!displayConversation) return "?";
    if (displayConversation.type === "channel") return "#";
    if (displayConversation.type === "group") {
      return (
        displayConversation.name
          ?.split(" ")
          .map((n: string) => n[0])
          .join("")
          .toUpperCase()
          .slice(0, 2) || "GC"
      );
    }
    const otherParticipant = displayConversation.participants?.find(
      (p: any) => p._id !== currentUserId
    );
    const displayName =
      otherParticipant?.name || otherParticipant?.email || "Unknown";
    return displayName
      .split(" ")
      .map((n: string) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  if (!conversationId && !pendingParticipant) {
    return (
      <div className="flex-1 flex items-center justify-center bg-white">
        <div className="text-center">
          <div className="text-lg font-medium text-gray-900 mb-2">
            Select a conversation
          </div>
          <p className="text-sm text-gray-500">
            Choose a conversation from the list to start messaging
          </p>
        </div>
      </div>
    );
  }

  const messagesToShow = conversationId ? messages : [];
  const canSend = !!conversationId || !!pendingParticipant;

  return (
    <div className="flex-1 flex flex-col bg-white min-w-0 min-h-0">
      {/* Chat Header — same height as Conversations header for alignment */}
      <div className="flex items-center min-h-[4.5rem] h-[4.5rem] px-4 bg-white border-b border-gray-200 shrink-0">
        <div className="flex items-center justify-between w-full min-w-0">
          <div className="flex items-center gap-3 min-w-0">
            <Avatar>
              <AvatarFallback>
                {displayConversation?.type === "group" ? (
                  <Users className="h-5 w-5" />
                ) : (
                  getInitials()
                )}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="font-medium text-gray-900 truncate">
                {getDisplayName()}
              </div>
              {displayConversation?.type !== "group" &&
                displayConversation?.type !== "channel" && (
                  <div className="text-sm text-gray-500 truncate">
                    {displayConversation?.participants?.find(
                      (p: any) => p._id !== currentUserId
                    )?.email || "Direct message"}
                  </div>
                )}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {(displayConversation?.type === "group" ||
              displayConversation?.type === "channel") && (
              <>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2 text-gray-600 hover:text-gray-900"
                      aria-label="View members"
                    >
                      <Users className="h-4 w-4 mr-1.5" />
                      <span className="text-sm font-medium">
                        {displayConversation.participants?.length || 0}
                      </span>
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-64 p-0">
                    <div className="p-2 border-b border-gray-200">
                      <div className="text-sm font-semibold text-gray-900">
                        Members ({displayConversation.participants?.length || 0})
                      </div>
                    </div>
                    <div className="max-h-60 overflow-y-auto p-2">
                      {(displayConversation.participants || []).map((p: any) => (
                        <div
                          key={p._id}
                          className="flex items-center gap-2 py-2 px-2 rounded hover:bg-gray-50"
                        >
                          <Avatar className="h-8 w-8">
                            <AvatarFallback className="text-xs">
                              {p.name
                                ?.split(" ")
                                .map((n: string) => n[0])
                                .join("")
                                .toUpperCase()
                                .slice(0, 2) || p.email?.[0]?.toUpperCase() || "?"}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium text-gray-900 truncate">
                              {p.name || p.email}
                            </div>
                            {p.email && (
                              <div className="text-xs text-gray-500 truncate">
                                {p.email}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
                {onAddMembers && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={onAddMembers}>
                        <Users className="h-4 w-4 mr-2" />
                        Add Members
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </>
            )}
            {conversationId && onDeleteConversation && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 text-gray-500 hover:text-red-600"
                  aria-label="Delete conversation"
                  onClick={() => setDeleteConfirmOpen(true)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
                <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Delete conversation?</DialogTitle>
                      <DialogDescription>
                        This cannot be undone. All messages in this conversation will be permanently deleted.
                      </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="gap-2 sm:gap-0">
                      <Button
                        variant="outline"
                        onClick={() => setDeleteConfirmOpen(false)}
                      >
                        Cancel
                      </Button>
                      <Button
                        variant="destructive"
                        onClick={async () => {
                          try {
                            await deleteConversationMutation({
                              conversationId: conversationId as Id<"conversations">,
                            });
                            setDeleteConfirmOpen(false);
                            onDeleteConversation(conversationId as Id<"conversations">);
                          } catch (e) {
                            console.error(e);
                          }
                        }}
                      >
                        Delete
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </>
            )}
            {onCloseConversation && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 text-gray-500 hover:text-gray-700"
                onClick={onCloseConversation}
                aria-label="Close conversation"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-white">
        {/* Load older messages button */}
        {conversationId && hasMoreMessages && (
          <div className="flex justify-center" ref={messagesTopRef}>
            <Button
              variant="outline"
              size="sm"
              onClick={loadOlderMessages}
              disabled={isLoadingOlder}
              className="mb-4"
            >
              {isLoadingOlder ? (
                <>
                  <div className="animate-spin h-4 w-4 border-2 border-gray-400 border-t-transparent rounded-full mr-2" />
                  Loading...
                </>
              ) : (
                <>
                  <ChevronUp className="h-4 w-4 mr-2" />
                  See more
                </>
              )}
            </Button>
          </div>
        )}
        {conversationId && isLoadingOlder && (
          <div className="space-y-4 mb-4">
            <MessageListSkeleton />
          </div>
        )}
        {conversationId && messagesData === undefined ? (
          <MessageListSkeleton />
        ) : (messagesToShow?.length ?? 0) === 0 ? (
          <div className="text-center text-gray-500 py-8">
            {pendingParticipant
              ? "Send a message to start the conversation."
              : "No messages yet. Start the conversation!"}
          </div>
        ) : (
          messagesToShow?.map((message: any) => {
            const isOwnMessage = message.senderId === currentUserId;
            const isHovered = hoveredMessageId === message._id;
            const actionButtons = (
              <div
                onMouseEnter={() => {
                  if (hoverLeaveTimeoutRef.current) {
                    clearTimeout(hoverLeaveTimeoutRef.current);
                    hoverLeaveTimeoutRef.current = null;
                  }
                  setHoveredMessageId(message._id);
                }}
                onMouseLeave={() => setHoveredMessageId(null)}
                className={`flex items-center justify-center gap-0.5 w-20 shrink-0 transition-opacity ${
                  isOwnMessage ? "order-first" : "order-last"
                } ${isHovered ? "opacity-100" : "opacity-0 pointer-events-none"}`}
              >
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 text-gray-500 hover:text-gray-700 hover:bg-gray-100"
                  aria-label="Reply"
                  onClick={() => {
                    setReplyingTo({
                      messageId: message._id,
                      contentSnippet:
                        message.content.slice(0, 80) +
                        (message.content.length > 80 ? "…" : ""),
                      senderName:
                        message.sender?.name ||
                        message.sender?.email ||
                        "Unknown",
                    });
                  }}
                >
                  <Reply className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 text-gray-500 hover:text-gray-700 hover:bg-gray-100"
                  aria-label="React"
                >
                  <Smile className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 text-gray-500 hover:text-gray-700 hover:bg-gray-100"
                  aria-label="Forward"
                  onClick={() => {
                    setMessageToForward({
                      content: message.content,
                      attachments: message.attachments,
                      messageType: message.messageType,
                    });
                    setForwardModalOpen(true);
                  }}
                >
                  <Forward className="h-3.5 w-3.5" />
                </Button>
              </div>
            );

            return (
              <div
                key={message._id}
                className={`flex items-center ${
                  isOwnMessage ? "justify-end" : "justify-start"
                }`}
              >
                {actionButtons}
                <div
                  role="article"
                  onMouseEnter={() => {
                    if (hoverLeaveTimeoutRef.current) {
                      clearTimeout(hoverLeaveTimeoutRef.current);
                      hoverLeaveTimeoutRef.current = null;
                    }
                    setHoveredMessageId(message._id);
                  }}
                  onMouseLeave={() => {
                    hoverLeaveTimeoutRef.current = setTimeout(() => {
                      setHoveredMessageId(null);
                      hoverLeaveTimeoutRef.current = null;
                    }, 150);
                  }}
                  className={`max-w-[70%] rounded-lg px-4 py-2 cursor-default ${
                    isOwnMessage
                      ? "bg-brand-purple text-white"
                      : "bg-gray-100 text-gray-900"
                  }`}
                >
                  {!isOwnMessage && (
                    <div className="text-xs font-medium mb-1 opacity-70">
                      {message.sender?.name || message.sender?.email}
                    </div>
                  )}
                  {message.replyTo && (
                    <div
                      className={`text-xs rounded border-l-2 pl-2 py-1 mb-2 ${
                        isOwnMessage
                          ? "border-purple-300 text-purple-100 bg-purple-500/20"
                          : "border-gray-300 text-gray-500 bg-gray-50"
                      }`}
                    >
                      <div className="font-medium opacity-90">
                        {message.replyTo.senderName}
                      </div>
                      <div className="truncate opacity-80">
                        {message.replyTo.content}
                      </div>
                    </div>
                  )}
                  <div className="text-sm whitespace-pre-wrap">
                    {message.content}
                  </div>
                  {message.attachments && message.attachments.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {message.attachments.map(
                        (attachmentId: string, idx: number) => (
                          <FileAttachment
                            key={idx}
                            storageId={attachmentId}
                            isOwnMessage={isOwnMessage}
                          />
                        ),
                      )}
                    </div>
                  )}
                  {message.payslipId && (
                    <div className="mt-2">
                      <Button
                        variant={isOwnMessage ? "secondary" : "outline"}
                        size="sm"
                        className={`text-xs ${
                          isOwnMessage
                            ? "bg-purple-500 hover:bg-purple-400 border-purple-400"
                            : ""
                        }`}
                        onClick={() => {
                          router.push(
                            `/payroll?payslipId=${message.payslipId}`,
                          );
                        }}
                      >
                        <Receipt className="h-3 w-3 mr-1" />
                        View Payslip
                      </Button>
                    </div>
                  )}
                  <div
                    className={`text-xs mt-1 ${
                      isOwnMessage ? "text-purple-100" : "text-gray-500"
                    }`}
                  >
                    {format(new Date(message.createdAt), "h:mm a")}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Message Input */}
      <div className="bg-white border-t border-gray-200 p-4">
        {replyingTo && (
          <div className="mb-2 flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
            <Reply className="h-4 w-4 shrink-0 text-gray-500" />
            <div className="flex-1 min-w-0">
              <span className="font-medium text-gray-700">
                Replying to {replyingTo.senderName}
              </span>
              <p className="truncate text-gray-500 text-xs mt-0.5">
                {replyingTo.contentSnippet}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 shrink-0"
              onClick={() => setReplyingTo(null)}
              aria-label="Cancel reply"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((att) => {
              const isImage =
                att.contentType?.startsWith("image/") && att.previewUrl;
              const isVideo =
                att.contentType?.startsWith("video/") && att.previewUrl;
              const showPreview = (isImage || isVideo) && !att.uploading;

              return (
                <div
                  key={att.id}
                  className="relative rounded-lg overflow-hidden bg-white border border-gray-200 w-[120px] h-[120px] shrink-0"
                >
                  {att.uploading ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-gray-50">
                      <div className="animate-spin h-6 w-6 border-2 border-purple-600 border-t-transparent rounded-full" />
                      <span className="text-xs text-gray-600 truncate px-1 max-w-full">
                        {att.name}
                      </span>
                    </div>
                  ) : showPreview ? (
                    <>
                      {isImage ? (
                        <img
                          src={att.previewUrl}
                          alt={att.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <video
                          src={att.previewUrl}
                          className="w-full h-full object-cover"
                          muted
                          playsInline
                        />
                      )}
                    </>
                  ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-gray-50 p-2">
                      <FileText className="h-6 w-6 text-gray-500" />
                      <span className="text-xs text-gray-600 truncate w-full text-center">
                        {att.name}
                      </span>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => handleRemoveAttachment(att.id)}
                    className="absolute top-1 right-1 h-6 w-6 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/70"
                    aria-label="Remove attachment"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <form onSubmit={handleSendMessage} className="flex gap-2">
          <div className="flex-1 flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleFileSelect}
              className="hidden"
              id="file-upload"
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isUploading}
                >
                  <Paperclip className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                >
                  <FileText className="h-4 w-4 mr-2" />
                  Upload File
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setIsDocumentModalOpen(true)}
                  disabled={isUploading}
                >
                  <FileText className="h-4 w-4 mr-2" />
                  Select from Documents
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Input
              value={messageContent}
              onChange={(e) => setMessageContent(e.target.value)}
              placeholder="Type a message..."
              className="flex-1"
            />
          </div>
          <Button
            type="submit"
            disabled={
              (!messageContent.trim() && attachments.length === 0) ||
              isUploading ||
              !canSend
            }
          >
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>

      <DocumentSelectorModal
        isOpen={isDocumentModalOpen}
        onOpenChange={setIsDocumentModalOpen}
        onSelect={handleSelectDocuments}
      />
      <ForwardMessageModal
        isOpen={forwardModalOpen}
        onOpenChange={(open) => {
          setForwardModalOpen(open);
          if (!open) setMessageToForward(null);
        }}
        message={messageToForward}
        currentConversationId={conversationId}
      />
    </div>
  );
}

// Content types that show inline preview (images including GIF; video)
function isPreviewableMedia(
  contentType: string | null,
): "image" | "video" | false {
  if (!contentType) return false;
  if (contentType.startsWith("image/")) return "image";
  if (contentType.startsWith("video/")) return "video";
  return false;
}

// Component to display file attachments in messages
function FileAttachment({
  storageId,
  isOwnMessage,
}: {
  storageId: string;
  isOwnMessage: boolean;
}) {
  const fileData = useQuery(
    (api as any).files.getFileUrlAndType,
    storageId ? { storageId: storageId as Id<"_storage"> } : "skip",
  );

  if (fileData === undefined) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <div className="animate-spin h-3 w-3 border-2 border-gray-400 border-t-transparent rounded-full" />
        <span>Loading file...</span>
      </div>
    );
  }

  if (!fileData?.url) {
    return <div className="text-xs text-gray-500">File not available</div>;
  }

  const { url } = fileData;
  const previewType = isPreviewableMedia(fileData.contentType ?? null);
  const downloadClass = isOwnMessage
    ? "bg-purple-500/20 text-white hover:bg-purple-500/30"
    : "bg-gray-100 text-gray-700 hover:bg-gray-200";

  // Image (including GIF): neutral container, no brand background
  if (previewType === "image") {
    return (
      <div className="space-y-1">
        <div className="rounded-lg overflow-hidden bg-white max-w-[280px] max-h-[320px]">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="block"
          >
            <img
              src={url}
              alt="Attachment"
              className="w-full h-auto object-contain max-h-[320px]"
            />
          </a>
        </div>
        <a
          href={url}
          download
          target="_blank"
          rel="noopener noreferrer"
          className={`inline-flex items-center gap-1.5 text-xs p-1.5 rounded transition-all ${downloadClass}`}
        >
          <Download className="h-3 w-3 shrink-0" />
          <span>Download</span>
        </a>
      </div>
    );
  }

  // Video: neutral container, no brand background
  if (previewType === "video") {
    return (
      <div className="space-y-1">
        <div className="rounded-lg overflow-hidden bg-white max-w-[280px] max-h-[320px]">
          <video src={url} controls className="w-full h-auto max-h-[320px]" />
        </div>
        <a
          href={url}
          download
          target="_blank"
          rel="noopener noreferrer"
          className={`inline-flex items-center gap-1.5 text-xs p-1.5 rounded transition-all ${downloadClass}`}
        >
          <Download className="h-3 w-3 shrink-0" />
          <span>Download</span>
        </a>
      </div>
    );
  }

  // PDF, docs, etc.: downloadable only
  return (
    <a
      href={url}
      download
      target="_blank"
      rel="noopener noreferrer"
      className={`flex items-center gap-2 text-xs p-2 rounded transition-all ${downloadClass}`}
    >
      <FileText className="h-4 w-4 shrink-0" />
      <span className="truncate">Attachment</span>
      <Download className="h-3 w-3 shrink-0 ml-auto" />
    </a>
  );
}
