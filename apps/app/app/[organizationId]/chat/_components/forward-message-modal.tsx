"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useOrganization } from "@/hooks/organization-context";
import { Id } from "@/convex/_generated/dataModel";
import { useToast } from "@/components/ui/use-toast";
import { Hash, Users, MessageSquare, Loader2 } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { encryptWithSessionKeyB64 } from "@/lib/chat-message-crypto";
import { useChatSessionKeys } from "./chat-session-keys-context";

export interface MessageToForward {
  content: string;
  attachments?: string[];
  messageType?: "text" | "image" | "file" | "system";
}

interface ForwardMessageModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  message: MessageToForward | null;
  /** Exclude this conversation from the list (e.g. current chat) */
  currentConversationId: string | null;
  onSuccess?: (targetConversationId: string) => void;
}

function getConversationDisplayName(conv: any) {
  if (conv.type === "channel") return `# ${conv.name || "Channel"}`;
  if (conv.type === "group") return conv.name || "Group Chat";
  const other = conv.participants?.[0];
  return other?.name || other?.email || "Direct message";
}

function getConversationIcon(conv: any) {
  if (conv.type === "channel") return <Hash className="h-4 w-4" />;
  if (conv.type === "group") return <Users className="h-4 w-4" />;
  const other = conv.participants?.[0];
  const initials = other?.name
    ?.split(" ")
    .map((n: string) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) || "?";
  return <AvatarFallback className="h-8 w-8 text-xs">{initials}</AvatarFallback>;
}

export function ForwardMessageModal({
  isOpen,
  onOpenChange,
  message,
  currentConversationId,
  onSuccess,
}: ForwardMessageModalProps) {
  const { currentOrganizationId } = useOrganization();
  const { toast } = useToast();
  const sessionKeys = useChatSessionKeys();

  const conversationsData = useQuery(
    (api as any).chat.getConversations,
    currentOrganizationId && isOpen
      ? { organizationId: currentOrganizationId, limit: 50 }
      : "skip"
  );

  const forwardMutation = useMutation((api as any).chat.forwardMessage);

  const conversations = conversationsData?.conversations ?? [];
  const [forwardingToId, setForwardingToId] = useState<string | null>(null);

  const handleForward = async (targetConversationId: string) => {
    if (!message || !currentOrganizationId) return;
    setForwardingToId(targetConversationId);
    try {
      const targetKey = sessionKeys[targetConversationId];
      let forwardContent = message.content;
      if (targetKey && forwardContent) {
        forwardContent = encryptWithSessionKeyB64(forwardContent, targetKey);
      }
      await forwardMutation({
        organizationId: currentOrganizationId as Id<"organizations">,
        targetConversationId: targetConversationId as Id<"conversations">,
        content: forwardContent,
        messageType: message.messageType || "text",
        attachments:
          (message.attachments?.length ?? 0) > 0
            ? (message.attachments as Id<"_storage">[])
            : undefined,
      });
      toast({ title: "Message forwarded" });
      onOpenChange(false);
      onSuccess?.(targetConversationId);
    } catch (err: any) {
      toast({
        title: "Failed to forward",
        description: err.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setForwardingToId(null);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Forward to</DialogTitle>
          <DialogDescription>
            Choose a conversation in your organization (group, channel, or direct message).
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto min-h-0 space-y-1 py-2">
          {conversations.length === 0 && (
            <p className="text-sm text-gray-500 py-4 text-center">
              No other conversations to forward to.
            </p>
          )}
          {conversations.map((conv: any) => {
            const isCurrent = conv._id === currentConversationId;
            const isForwarding = forwardingToId === conv._id;
            return (
              <button
                key={conv._id}
                type="button"
                disabled={isCurrent || !!forwardingToId}
                onClick={() => handleForward(conv._id)}
                className={`w-full flex items-center gap-3 p-3 rounded-lg text-left transition-colors ${
                  isCurrent
                    ? "opacity-50 cursor-not-allowed bg-gray-50"
                    : "hover:bg-gray-100"
                }`}
              >
                <div className="shrink-0 text-gray-600">
                  {conv.type === "direct" ? (
                    <Avatar className="h-8 w-8">
                      {getConversationIcon(conv)}
                    </Avatar>
                  ) : (
                    <div className="h-8 w-8 rounded-full bg-gray-200 flex items-center justify-center">
                      {getConversationIcon(conv)}
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-gray-900 truncate">
                    {getConversationDisplayName(conv)}
                  </div>
                  {conv.type !== "direct" && (
                    <div className="text-xs text-gray-500">
                      {conv.participants?.length ?? 0} members
                    </div>
                  )}
                </div>
                {isCurrent && (
                  <span className="text-xs text-gray-400 shrink-0">(current)</span>
                )}
                {isForwarding && (
                  <Loader2 className="h-4 w-4 animate-spin text-gray-500 shrink-0" />
                )}
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
