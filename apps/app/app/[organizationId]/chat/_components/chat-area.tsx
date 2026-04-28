"use client";

import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useMemo,
} from "react";
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
import { chatCache, mergeChatMessagesById } from "@/services/chat-cache-service";
import { CachedFileAttachment } from "./chat-file-attachment";
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
import { getOrganizationPath } from "@/utils/organization-routing";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  decryptWithSessionKeyB64,
  encryptWithSessionKeyB64,
  isEncryptedPayload,
} from "@/lib/chat-message-crypto";
import { useChatSessionKeys } from "./chat-session-keys-context";
import {
  directConversationAvatarInitials,
  directConversationSubtitle,
  directConversationTitle,
  messageSenderLabelInDirect,
} from "@/lib/chat-thread-display";

function scopeMessagesToConversation(
  msgs: any[],
  conversationId: string | null,
): any[] {
  if (!conversationId) return [];
  const cid = String(conversationId);
  return msgs.filter(
    (m) => m?.conversationId != null && String(m.conversationId) === cid,
  );
}

function messagesBelongToConversation(
  msgs: any[],
  conversationId: string,
): boolean {
  if (msgs.length === 0) return true;
  const cid = String(conversationId);
  return msgs.every(
    (m) => m?.conversationId != null && String(m.conversationId) === cid,
  );
}

interface ChatAreaProps {
  conversationId: string | null;
  conversation: any;
  currentUserId?: string;
  /** When starting a new DM, conversation is created on first message send. */
  pendingParticipant?: { _id: string; name?: string; email?: string };
  /** Elevated users: open DM that will be created as staff "Admin" persona (separate from personal DM). */
  pendingAsAdmin?: boolean;
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
  pendingAsAdmin = false,
  onFirstMessageSent,
  onAddMembers,
  onCloseConversation,
  onDeleteConversation,
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
  /** After prepending older messages, restore scroll so the viewport stays put */
  const scrollRestoreRef = useRef<{ height: number; top: number } | null>(null);
  const prevMessageCountRef = useRef(0);

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

  // Reset first on conversation change so merges/cache never see the previous thread.
  useEffect(() => {
    let cancelled = false;
    scrollRestoreRef.current = null;
    prevMessageCountRef.current = 0;
    setAllMessages([]);
    setOldestTimestamp(null);
    setIsLoadingOlder(false);
    isLoadingOlderRef.current = false;
    setLoadOlderTrigger(0);
    setReplyingTo(null);
    setHoveredMessageId(null);

    if (!conversationId || !currentOrganizationId) return;

    (async () => {
      try {
        await chatCache.initialize(currentOrganizationId);
        const cached = await chatCache.getCachedMessages(conversationId);
        if (cancelled || cached.length === 0) return;
        setAllMessages((prev) =>
          mergeChatMessagesById(
            scopeMessagesToConversation(prev, conversationId),
            cached,
          ),
        );
      } catch (e) {
        console.error("Hydrate messages from cache:", e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [conversationId, currentOrganizationId]);

  // Sync from Convex after reset (same tick: [] then merge sees empty prev)
  useEffect(() => {
    if (!conversationId || !messagesData) return;

    const incoming = messagesData.messages.filter(
      (m: any) => String(m.conversationId) === String(conversationId),
    );
    // Drop stale query results from the previous conversation
    if (
      messagesData.messages.length > 0 &&
      incoming.length === 0
    ) {
      return;
    }

    if (isLoadingOlderRef.current) {
      setAllMessages((prev) => {
        const base = scopeMessagesToConversation(prev, conversationId);
        const newMessages = incoming.filter(
          (newMsg: any) =>
            !base.some((oldMsg: any) => oldMsg._id === newMsg._id),
        );
        return [...newMessages, ...base];
      });
    } else {
      setAllMessages((prev) =>
        mergeChatMessagesById(
          incoming,
          scopeMessagesToConversation(prev, conversationId),
        ),
      );
    }
    setIsLoadingOlder(false);
    isLoadingOlderRef.current = false;
  }, [conversationId, messagesData]);

  const messages = useMemo(
    () => scopeMessagesToConversation(allMessages, conversationId),
    [allMessages, conversationId],
  );

  const sessionKeyB64 =
    conversationId && sessionKeys[conversationId]
      ? sessionKeys[conversationId]
      : undefined;

  const displayMessages = useMemo(() => {
    if (!sessionKeyB64) return messages;
    return messages.map((m: any) => ({
      ...m,
      content: decryptWithSessionKeyB64(m.content, sessionKeyB64),
      replyTo: m.replyTo
        ? {
            ...m.replyTo,
            content:
              typeof m.replyTo.content === "string" &&
              isEncryptedPayload(m.replyTo.content)
                ? decryptWithSessionKeyB64(m.replyTo.content, sessionKeyB64)
                : m.replyTo.content,
          }
        : null,
    }));
  }, [messages, sessionKeyB64]);

  // Oldest message time for pagination (current thread only)
  useEffect(() => {
    if (messages.length === 0) {
      setOldestTimestamp(null);
      return;
    }
    setOldestTimestamp(
      Math.min(...messages.map((m: any) => m.createdAt)),
    );
  }, [messages]);

  // Clear hover leave timeout on unmount
  useEffect(() => {
    return () => {
      if (hoverLeaveTimeoutRef.current)
        clearTimeout(hoverLeaveTimeoutRef.current);
    };
  }, []);

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
      messages.length === 0
    )
      return;
    const unreadIds = messages
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
  }, [conversationId, currentUserId, messages]);

  // Cache only rows that belong to this conversation (avoids cross-thread writes on switch)
  useEffect(() => {
    if (
      messages.length === 0 ||
      !conversationId ||
      !messagesBelongToConversation(messages, conversationId)
    ) {
      return;
    }
    chatCache.cacheMessages(conversationId, messages).catch((error) => {
      console.error("Error caching messages:", error);
    });
  }, [messages, conversationId]);

  const loadOlderMessages = () => {
    if (!hasMoreMessages || isLoadingOlder || !oldestTimestamp) return;
    const el = messagesListRef.current;
    if (el) {
      scrollRestoreRef.current = {
        height: el.scrollHeight,
        top: el.scrollTop,
      };
    }
    setIsLoadingOlder(true);
    isLoadingOlderRef.current = true;
    // Trigger query with current oldestTimestamp to fetch older messages
    setLoadOlderTrigger((prev) => prev + 1);
  };

  // Newer messages at bottom: scroll down when the list grows (open thread, sync, new msgs).
  // "See more" prepends older rows — restore scroll so we don't jump to the bottom.
  useLayoutEffect(() => {
    const el = messagesListRef.current;
    if (!el || !conversationId) return;

    if (scrollRestoreRef.current != null) {
      const { height: prevH, top: prevTop } = scrollRestoreRef.current;
      scrollRestoreRef.current = null;
      const delta = el.scrollHeight - prevH;
      el.scrollTop = prevTop + delta;
      prevMessageCountRef.current = messages.length;
      return;
    }

    if (messages.length === 0) {
      prevMessageCountRef.current = 0;
      return;
    }

    const prevCount = prevMessageCountRef.current;
    prevMessageCountRef.current = messages.length;

    if (messages.length <= prevCount) return;

    // Stick to newest messages (bottom). Older rows only load via "See more"
    // above, which uses scrollRestoreRef instead of this path.
    const pinBottom = () => {
      el.scrollTop = el.scrollHeight;
    };
    pinBottom();
    requestAnimationFrame(() => {
      const list = messagesListRef.current;
      if (list) list.scrollTop = list.scrollHeight;
    });
    requestAnimationFrame(() => {
      const list = messagesListRef.current;
      if (list) list.scrollTop = list.scrollHeight;
    });
  }, [messages, conversationId]);

  // Images / late layout can grow scrollHeight; stay pinned if already near the bottom
  useEffect(() => {
    const el = messagesListRef.current;
    if (!el || !conversationId) return;
    const ro = new ResizeObserver(() => {
      const list = messagesListRef.current;
      if (!list || list.scrollHeight <= list.clientHeight) return;
      const gap = list.scrollHeight - list.scrollTop - list.clientHeight;
      if (gap < 160) list.scrollTop = list.scrollHeight;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [conversationId]);

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
          directThreadKind: pendingAsAdmin ? "staff_as_admin" : "standard",
        });
        targetConversationId = newConversationId;
        onFirstMessageSent?.(newConversationId);
      }
      if (!targetConversationId) return;

      const keyForSend = sessionKeys[targetConversationId];
      let contentOut = content;
      if (keyForSend && contentOut) {
        contentOut = encryptWithSessionKeyB64(contentOut, keyForSend);
      }

      await sendMessageMutation({
        conversationId: targetConversationId as Id<"conversations">,
        content: contentOut,
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

  const displayConversation = useMemo(() => {
    if (conversation) return conversation;
    if (!pendingParticipant) return null;
    const base = {
      type: "direct" as const,
      participants: [pendingParticipant],
    };
    if (pendingAsAdmin && currentUserId) {
      return {
        ...base,
        directThreadKind: "staff_as_admin" as const,
        adminPersonaUserId: currentUserId,
      };
    }
    return base;
  }, [conversation, pendingParticipant, pendingAsAdmin, currentUserId]);

  const headerTitle = displayConversation
    ? displayConversation.type === "channel"
      ? `# ${displayConversation.name || "Channel"}`
      : displayConversation.type === "group"
        ? displayConversation.name || "Group Chat"
        : directConversationTitle(displayConversation, currentUserId)
    : "";

  const headerSubtitle = displayConversation
    ? directConversationSubtitle(displayConversation, currentUserId)
    : "";

  const headerInitials = displayConversation
    ? displayConversation.type === "group"
      ? displayConversation.name
          ?.split(" ")
          .map((n: string) => n[0])
          .join("")
          .toUpperCase()
          .slice(0, 2) || "GC"
      : displayConversation.type === "channel"
        ? "#"
        : directConversationAvatarInitials(displayConversation, currentUserId)
    : "?";

  if (!conversationId && !pendingParticipant) {
    return (
      <div className="flex flex-1 flex-col min-h-0 bg-white">
        {/* Spacer aligned with ConversationList header (same row height as Chat / thread header) */}
        <div className="h-16 shrink-0 border-b border-gray-200 bg-white" aria-hidden />
        <div className="flex flex-1 min-h-0 items-center justify-center px-6">
          <div className="text-center max-w-md">
            <div className="text-lg font-medium text-gray-900 mb-2">
              Select a conversation
            </div>
            <p className="text-sm text-gray-500">
              Choose a conversation from the list to start messaging
            </p>
          </div>
        </div>
      </div>
    );
  }

  const messagesToShow = conversationId ? displayMessages : [];
  const canSend = !!conversationId || !!pendingParticipant;

  return (
    <div className="flex-1 flex flex-col bg-white min-w-0 min-h-0">
      {/* Chat header — h-16 matches ConversationList "Chat" row */}
      <div className="flex h-16 shrink-0 items-center px-4 bg-white border-b border-gray-200">
        <div className="flex items-center justify-between gap-2 w-full min-w-0">
          <div className="flex items-center gap-3 min-w-0">
            <Avatar className="h-9 w-9">
              <AvatarFallback>
                {displayConversation?.type === "group" ? (
                  <Users className="h-5 w-5" />
                ) : displayConversation?.type === "channel" ? (
                  "#"
                ) : (
                  headerInitials
                )}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 py-0.5">
              <div className="text-sm font-semibold text-gray-900 truncate leading-tight">
                {headerTitle}
              </div>
              {displayConversation?.type !== "group" &&
                displayConversation?.type !== "channel" &&
                headerSubtitle && (
                  <div className="text-xs text-gray-500 truncate leading-tight mt-0.5">
                    {headerSubtitle}
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

      {/* Messages — min-h-0 so flex-1 can shrink; without it, min-height:auto grows with content and no inner scroll (page scrolls instead). */}
      <div
        ref={messagesListRef}
        className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4 bg-white"
      >
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
        {conversationId &&
        messagesData === undefined &&
        messages.length === 0 ? (
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
            const threadConv =
              conversationId && conversation
                ? conversation
                : displayConversation;
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
                      senderName: messageSenderLabelInDirect(
                        message.senderId,
                        message.sender,
                        threadConv,
                        currentUserId,
                      ),
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
                  {isOwnMessage &&
                    threadConv?.type === "direct" &&
                    threadConv.directThreadKind === "staff_as_admin" &&
                    threadConv.adminPersonaUserId === message.senderId && (
                      <div className="text-xs font-medium mb-1 opacity-80 text-right">
                        {messageSenderLabelInDirect(
                          message.senderId,
                          message.sender,
                          threadConv,
                          currentUserId,
                        )}
                      </div>
                    )}
                  {!isOwnMessage && (
                    <div className="text-xs font-medium mb-1 opacity-70">
                      {messageSenderLabelInDirect(
                        message.senderId,
                        message.sender,
                        threadConv,
                        currentUserId,
                      )}
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
                          <CachedFileAttachment
                            key={idx}
                            storageId={attachmentId}
                            isOwnMessage={isOwnMessage}
                            organizationId={currentOrganizationId || ""}
                          />
                        ),
                      )}
                    </div>
                  )}
                  {message.payslipId && (
                    <div className="mt-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className={
                          isOwnMessage
                            ? "text-xs bg-white text-gray-900 border-white/60 shadow-sm hover:bg-gray-50"
                            : "text-xs"
                        }
                        onClick={() => {
                          const orgId =
                            effectiveOrganizationId ?? currentOrganizationId;
                          if (!orgId) return;
                          // Employees are blocked from /payroll by route guard (→ /forbidden). Send them to My Payslips.
                          const isEmployee = currentOrganization?.role === "employee";
                          const subpath = isEmployee
                            ? `payslips?payslipId=${message.payslipId}`
                            : `payroll?payslipId=${message.payslipId}`;
                          router.push(getOrganizationPath(orgId, subpath));
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
        <div aria-hidden className="h-px shrink-0" />
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
        <form
          onSubmit={handleSendMessage}
          className="flex w-full items-stretch gap-2"
        >
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
                disabled={isUploading}
                className="h-11 w-11 shrink-0 rounded-lg border-gray-200 p-0 hover:bg-gray-50"
                aria-label="Attach"
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
            className="h-11 min-w-0 flex-1 rounded-lg border-gray-200 py-0 text-sm shadow-sm focus-visible:ring-2 focus-visible:ring-brand-purple/30"
            aria-label="Message"
          />
          <Button
            type="submit"
            disabled={
              (!messageContent.trim() && attachments.length === 0) ||
              isUploading ||
              !canSend
            }
            className="h-11 w-11 shrink-0 rounded-lg p-0 bg-brand-purple text-white hover:bg-brand-purple/90 disabled:opacity-50"
            aria-label="Send message"
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
