"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Hash, Loader2, MessageSquare, Users } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { useOrganization } from "@/hooks/organization-context";
import type { ChatConversation } from "@/lib/chat/types";
import { errorMessage } from "@/lib/chat/types";
import {
  directConversationAvatarInitials,
  directConversationTitle,
} from "@/lib/chat-thread-display";

export type MessageToForward = {
  messageId: Id<"messages">;
};

type ForwardMessageModalProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  message: MessageToForward | null;
  currentConversationId: string | null;
  currentUserId?: string;
  onSuccess?: (targetConversationId: Id<"conversations">) => void;
};

function ConversationIcon({
  conversation,
  currentUserId,
}: {
  conversation: ChatConversation;
  currentUserId?: string;
}) {
  if (conversation.type === "channel") return <Hash className="h-4 w-4" />;
  if (conversation.type === "group") return <Users className="h-4 w-4" />;
  return (
    <span className="text-xs font-semibold">
      {directConversationAvatarInitials(conversation, currentUserId)}
    </span>
  );
}

export function ForwardMessageModal({
  isOpen,
  onOpenChange,
  message,
  currentConversationId,
  currentUserId,
  onSuccess,
}: ForwardMessageModalProps) {
  const { currentOrganizationId } = useOrganization();
  const { toast } = useToast();
  const [forwardingToId, setForwardingToId] =
    useState<Id<"conversations"> | null>(null);
  const conversationsData = useQuery(
    api.chat.getConversations,
    currentOrganizationId && isOpen
      ? { organizationId: currentOrganizationId, limit: 50 }
      : "skip",
  );
  const forwardMessage = useMutation(api.chat.forwardMessage);
  const conversations = (conversationsData?.conversations ?? []) as ChatConversation[];

  const handleForward = async (targetConversationId: Id<"conversations">) => {
    if (!message || !currentOrganizationId) return;
    setForwardingToId(targetConversationId);
    try {
      await forwardMessage({
        organizationId: currentOrganizationId,
        targetConversationId,
        sourceMessageId: message.messageId,
      });
      toast({ title: "Message forwarded" });
      onOpenChange(false);
      onSuccess?.(targetConversationId);
    } catch (error: unknown) {
      toast({
        title: "Could not forward message",
        description: errorMessage(error, "Please try again."),
        variant: "destructive",
      });
    } finally {
      setForwardingToId(null);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-md flex-col">
        <DialogHeader>
          <DialogTitle>Forward message</DialogTitle>
          <DialogDescription>
            Choose another conversation in this organization.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-40 flex-1 space-y-1 overflow-y-auto py-2">
          {conversationsData === undefined ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : conversations.length === 0 ? (
            <div className="flex h-32 flex-col items-center justify-center text-center">
              <MessageSquare className="mb-2 h-8 w-8 text-muted-foreground/60" />
              <p className="text-sm text-muted-foreground">
                No other conversations available.
              </p>
            </div>
          ) : (
            conversations.map((conversation) => {
              const isCurrent = conversation._id === currentConversationId;
              const isForwarding = forwardingToId === conversation._id;
              return (
                <button
                  key={conversation._id}
                  type="button"
                  disabled={isCurrent || forwardingToId !== null}
                  onClick={() => void handleForward(conversation._id)}
                  className="flex w-full items-center gap-3 rounded-xl p-3 text-left transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Avatar className="h-9 w-9">
                    <AvatarFallback>
                      <ConversationIcon
                        conversation={conversation}
                        currentUserId={currentUserId}
                      />
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {conversation.type === "channel" ? "# " : ""}
                      {directConversationTitle(conversation, currentUserId)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {isCurrent ? "Current conversation" : "Forward here"}
                    </p>
                  </div>
                  {isForwarding && <Loader2 className="h-4 w-4 animate-spin" />}
                </button>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
