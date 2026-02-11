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
import { chatCache } from "@/services/chat-cache-service";
import { generateUploadUrl } from "@/actions/files";
import { DocumentSelectorModal } from "./document-selector-modal";
import { MessageSkeleton, MessageListSkeleton } from "./skeletons";

interface ChatAreaProps {
  conversationId: string | null;
  conversation: any;
  currentUserId?: string;
  onAddMembers?: () => void;
}

export function ChatArea({
  conversationId,
  conversation,
  currentUserId,
  onAddMembers,
}: ChatAreaProps) {
  const router = useRouter();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesTopRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [messageContent, setMessageContent] = useState("");
  const [attachments, setAttachments] = useState<
    Array<{ id: string; name: string; storageId?: string; uploading?: boolean }>
  >([]);
  const [isDocumentModalOpen, setIsDocumentModalOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [allMessages, setAllMessages] = useState<any[]>([]);
  const [oldestTimestamp, setOldestTimestamp] = useState<number | null>(null);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);

  const [loadOlderTrigger, setLoadOlderTrigger] = useState(0);

  const messagesData = useQuery(
    (api as any).chat.getMessages,
    conversationId
      ? {
          conversationId: conversationId as Id<"conversations">,
          limit: 50,
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
  }, [conversationId]);

  const messages = allMessages;
  const hasMoreMessages = messagesData?.hasMore || false;

  const sendMessageMutation = useMutation((api as any).chat.sendMessage);

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

    setIsUploading(true);
    const newAttachments: Array<{
      id: string;
      name: string;
      storageId?: string;
      uploading?: boolean;
    }> = [];

    for (const file of Array.from(files)) {
      const fileId = `${Date.now()}-${Math.random()}`;
      newAttachments.push({
        id: fileId,
        name: file.name,
        uploading: true,
      });

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
        alert(`Failed to upload ${file.name}`);
      }
    }

    setIsUploading(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleRemoveAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((att) => att.id !== id));
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
    if ((!messageContent.trim() && attachments.length === 0) || !conversationId)
      return;

    // Wait for all attachments to finish uploading
    const pendingAttachments = attachments.filter(
      (att) => att.uploading || !att.storageId,
    );
    if (pendingAttachments.length > 0) {
      alert("Please wait for all files to finish uploading");
      return;
    }

    const attachmentStorageIds = attachments
      .filter((att) => att.storageId)
      .map((att) => att.storageId!);

    try {
      await sendMessageMutation({
        conversationId: conversationId as Id<"conversations">,
        content:
          messageContent ||
          (attachmentStorageIds.length > 0 ? "📎 File(s)" : ""),
        messageType: attachmentStorageIds.length > 0 ? "file" : "text",
        attachments:
          attachmentStorageIds.length > 0
            ? attachmentStorageIds.map((id) => id as Id<"_storage">)
            : undefined,
      });
      setMessageContent("");
      setAttachments([]);
    } catch (error) {
      console.error("Error sending message:", error);
      alert("Failed to send message. Please try again.");
    }
  };

  const getDisplayName = () => {
    if (conversation.type === "group") {
      return conversation.name || "Group Chat";
    }
    const otherParticipant = conversation.participants?.[0];
    return otherParticipant?.name || otherParticipant?.email || "Unknown User";
  };

  const getInitials = () => {
    if (conversation.type === "group") {
      return (
        conversation.name
          ?.split(" ")
          .map((n: string) => n[0])
          .join("")
          .toUpperCase()
          .slice(0, 2) || "GC"
      );
    }
    const otherParticipant = conversation.participants?.[0];
    const displayName =
      otherParticipant?.name || otherParticipant?.email || "Unknown";
    return displayName
      .split(" ")
      .map((n: string) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  if (!conversationId || !conversation) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50">
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

  return (
    <div className="flex-1 flex flex-col bg-gray-50 min-w-0 min-h-0">
      {/* Chat Header */}
      <div className="bg-white border-b border-gray-200 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Avatar>
              <AvatarFallback>
                {conversation.type === "group" ? (
                  <Users className="h-5 w-5" />
                ) : (
                  getInitials()
                )}
              </AvatarFallback>
            </Avatar>
            <div>
              <div className="font-medium text-gray-900">
                {getDisplayName()}
              </div>
              {conversation.type === "group" ? (
                <div className="text-sm text-gray-500">
                  {conversation.participants?.length || 0} members
                </div>
              ) : (
                <div className="text-sm text-gray-500">
                  {conversation.participants?.[0]?.email}
                </div>
              )}
            </div>
          </div>
          {conversation.type === "group" && onAddMembers && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm">
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
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Load older messages button */}
        {hasMoreMessages && (
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
                  See Older Messages
                </>
              )}
            </Button>
          </div>
        )}
        {isLoadingOlder && (
          <div className="space-y-4 mb-4">
            <MessageListSkeleton />
          </div>
        )}
        {messages === undefined ? (
          <MessageListSkeleton />
        ) : messages?.length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            No messages yet. Start the conversation!
          </div>
        ) : (
          messages?.map((message: any) => {
            const isOwnMessage = message.senderId === currentUserId;
            return (
              <div
                key={message._id}
                className={`flex ${isOwnMessage ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[70%] rounded-lg px-4 py-2 ${
                    isOwnMessage
                      ? "bg-brand-purple text-white"
                      : "bg-white text-gray-900 border border-gray-200"
                  }`}
                >
                  {!isOwnMessage && (
                    <div className="text-xs font-medium mb-1 opacity-70">
                      {message.sender?.name || message.sender?.email}
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
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((att) => (
              <div
                key={att.id}
                className="flex items-center gap-1 bg-gray-100 rounded px-2 py-1 text-sm"
              >
                {att.uploading ? (
                  <>
                    <div className="animate-spin h-3 w-3 border-2 border-purple-600 border-t-transparent rounded-full" />
                    <span className="text-gray-600">{att.name}</span>
                  </>
                ) : (
                  <>
                    <FileText className="h-3 w-3 text-gray-600" />
                    <span className="text-gray-700">{att.name}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveAttachment(att.id)}
                      className="ml-1 text-gray-500 hover:text-gray-700"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </>
                )}
              </div>
            ))}
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
              isUploading
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
    </div>
  );
}

// Component to display file attachments in messages
function FileAttachment({
  storageId,
  isOwnMessage,
}: {
  storageId: string;
  isOwnMessage: boolean;
}) {
  const fileUrl = useQuery(
    (api as any).files.getFileUrl,
    storageId ? { storageId: storageId as Id<"_storage"> } : "skip",
  );

  if (fileUrl === undefined) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <div className="animate-spin h-3 w-3 border-2 border-gray-400 border-t-transparent rounded-full" />
        <span>Loading file...</span>
      </div>
    );
  }

  if (!fileUrl) {
    return <div className="text-xs text-gray-500">File not available</div>;
  }

  return (
    <a
      href={fileUrl}
      download
      target="_blank"
      rel="noopener noreferrer"
      className={`flex items-center gap-2 text-xs p-2 rounded border transition-all ${
        isOwnMessage
          ? "bg-purple-500/20 border-purple-400/50 text-white hover:bg-purple-500/30"
          : "bg-gray-100 border-gray-300 text-gray-700 hover:bg-gray-200"
      }`}
    >
      <FileText className="h-4 w-4 shrink-0" />
      <span className="truncate">Attachment</span>
      <Download className="h-3 w-3 shrink-0 ml-auto" />
    </a>
  );
}
