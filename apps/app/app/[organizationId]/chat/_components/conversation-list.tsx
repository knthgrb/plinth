"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { format } from "date-fns";
import {
  BellOff,
  CheckCheck,
  Hash,
  ListFilter,
  MessageSquare,
  MoreHorizontal,
  Pin,
  Plus,
  Search,
  Users,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useOrganization } from "@/hooks/organization-context";
import {
  decryptWithSessionKeyB64,
  isEncryptedPayload,
} from "@/lib/chat-message-crypto";
import {
  directConversationAvatarInitials,
  directConversationTitle,
} from "@/lib/chat-thread-display";
import type { ChatConversation } from "@/lib/chat/types";
import { cn } from "@/utils/utils";
import { useChatSessionKeys } from "./chat-session-keys-context";
import { ConversationListSkeleton } from "./skeletons";

type ConversationListProps = {
  selectedConversationId: string | null;
  onSelectConversation: (id: Id<"conversations">) => void;
  onCreateGroupChat: () => void;
  onNewChat: () => void;
  onCreateChannel?: () => void;
  onBrowseChannels: () => void;
  currentUserId?: string;
};

function previewText(
  conversation: ChatConversation,
  sessionKeys: Record<string, string>,
): string {
  const message = conversation.lastMessage;
  if (!message) return "No messages yet";
  if (message.deletedAt !== undefined) return "Message removed";
  const key = sessionKeys[conversation._id];
  if (key && isEncryptedPayload(message.content)) {
    return decryptWithSessionKeyB64(message.content, key);
  }
  return message.content;
}

export function ConversationList({
  selectedConversationId,
  onSelectConversation,
  onCreateGroupChat,
  onNewChat,
  onCreateChannel,
  onBrowseChannels,
  currentUserId,
}: ConversationListProps) {
  const { effectiveOrganizationId } = useOrganization();
  const sessionKeys = useChatSessionKeys();
  const [search, setSearch] = useState("");
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const conversationsData = useQuery(
    api.chat.getConversations,
    effectiveOrganizationId
      ? { organizationId: effectiveOrganizationId, limit: 100 }
      : "skip",
  );
  const pinnedConversationIds = useQuery(
    api.chat.getPinnedConversations,
    effectiveOrganizationId
      ? { organizationId: effectiveOrganizationId }
      : "skip",
  );
  const mutedConversationIds = useQuery(
    api.chat.getMutedConversationIds,
    effectiveOrganizationId
      ? { organizationId: effectiveOrganizationId }
      : "skip",
  );
  const unreadCounts = useQuery(
    api.chat.getUnreadCounts,
    effectiveOrganizationId
      ? { organizationId: effectiveOrganizationId }
      : "skip",
  );
  const togglePin = useMutation(api.chat.togglePinConversation);
  const markAllRead = useMutation(api.chat.markAllConversationsAsRead);

  const conversations = useMemo(
    () => (conversationsData?.conversations ?? []) as ChatConversation[],
    [conversationsData?.conversations],
  );
  const pinnedSet = useMemo(
    () => new Set<string>(pinnedConversationIds ?? []),
    [pinnedConversationIds],
  );
  const mutedSet = useMemo(
    () => new Set<string>(mutedConversationIds ?? []),
    [mutedConversationIds],
  );
  const visibleConversations = useMemo(() => {
    const query = search.trim().toLowerCase();
    return conversations.filter((conversation) => {
      const title = directConversationTitle(conversation, currentUserId).toLowerCase();
      const matchesSearch = !query || title.includes(query);
      const unread = unreadCounts?.[conversation._id] ?? 0;
      return matchesSearch && (!showUnreadOnly || unread > 0);
    });
  }, [conversations, currentUserId, search, showUnreadOnly, unreadCounts]);
  const pinned = visibleConversations.filter((conversation) =>
    pinnedSet.has(conversation._id),
  );
  const unpinned = visibleConversations.filter(
    (conversation) => !pinnedSet.has(conversation._id),
  );

  const renderConversation = (conversation: ChatConversation) => {
    const selected = selectedConversationId === conversation._id;
    const unread = unreadCounts?.[conversation._id] ?? 0;
    const muted = mutedSet.has(conversation._id);
    const title = directConversationTitle(conversation, currentUserId);
    return (
      <button
        key={conversation._id}
        type="button"
        onClick={() => onSelectConversation(conversation._id)}
        className={cn(
          "group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
          selected ? "bg-brand-purple/10" : "hover:bg-muted/70",
        )}
      >
        <Avatar className="h-10 w-10 shrink-0">
          <AvatarFallback
            className={cn(
              selected && "bg-brand-purple text-white",
            )}
          >
            {conversation.type === "channel" ? (
              <Hash className="h-4 w-4" />
            ) : conversation.type === "group" ? (
              <Users className="h-4 w-4" />
            ) : (
              directConversationAvatarInitials(conversation, currentUserId)
            )}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className={cn("truncate text-sm", unread > 0 ? "font-semibold" : "font-medium")}>
              {conversation.type === "channel" ? "# " : ""}
              {title}
            </p>
            {muted && <BellOff className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
          </div>
          <p className={cn("truncate text-xs", unread > 0 ? "text-foreground" : "text-muted-foreground")}>
            {previewText(conversation, sessionKeys)}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {conversation.lastMessage && (
            <span className="text-[11px] text-muted-foreground">
              {format(new Date(conversation.lastMessage.createdAt), "MMM d")}
            </span>
          )}
          <div className="flex items-center gap-1">
            {unread > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-purple px-1.5 text-[11px] font-semibold text-white">
                {unread > 99 ? "99+" : unread}
              </span>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn(
                "h-6 w-6 opacity-0 group-hover:opacity-100",
                pinnedSet.has(conversation._id) && "opacity-100 text-brand-purple",
              )}
              onClick={(event) => {
                event.stopPropagation();
                if (!effectiveOrganizationId) return;
                void togglePin({
                  organizationId: effectiveOrganizationId,
                  conversationId: conversation._id,
                });
              }}
              aria-label={pinnedSet.has(conversation._id) ? "Unpin" : "Pin"}
            >
              <Pin className={cn("h-3.5 w-3.5", pinnedSet.has(conversation._id) && "fill-current")} />
            </Button>
          </div>
        </div>
      </button>
    );
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-background lg:w-80">
      <div className="flex h-16 shrink-0 items-center justify-between border-b px-4">
        <div>
          <h1 className="text-base font-semibold">Messages</h1>
          <p className="text-xs text-muted-foreground">Organization communication</p>
        </div>
        <div className="flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon" aria-label="Conversation filters">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setShowUnreadOnly((value) => !value)}>
                <ListFilter className="mr-2 h-4 w-4" />
                {showUnreadOnly ? "Show all conversations" : "Show unread only"}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  effectiveOrganizationId &&
                  void markAllRead({ organizationId: effectiveOrganizationId })
                }
              >
                <CheckCheck className="mr-2 h-4 w-4" />
                Mark all as read
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon" aria-label="Start conversation">
                <Plus className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuLabel>New conversation</DropdownMenuLabel>
              <DropdownMenuItem onClick={onNewChat}>
                <MessageSquare className="mr-2 h-4 w-4" />
                Direct message
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onCreateGroupChat}>
                <Users className="mr-2 h-4 w-4" />
                Private group
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onBrowseChannels}>
                <Search className="mr-2 h-4 w-4" />
                Browse official channels
              </DropdownMenuItem>
              {onCreateChannel && (
                <DropdownMenuItem onClick={onCreateChannel}>
                  <Hash className="mr-2 h-4 w-4" />
                  Create official channel
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="border-b p-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search conversations"
            className="h-9 rounded-xl bg-muted/50 pl-9"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {conversationsData === undefined ? (
          <ConversationListSkeleton />
        ) : visibleConversations.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center px-6 text-center">
            <MessageSquare className="mb-3 h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm font-medium">
              {search ? "No conversations found" : showUnreadOnly ? "You are all caught up" : "No conversations yet"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {search ? "Try a different name." : "Start a direct message or browse official channels."}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {pinned.length > 0 && (
              <section>
                <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Pinned</p>
                <div className="space-y-0.5">{pinned.map(renderConversation)}</div>
              </section>
            )}
            {unpinned.length > 0 && (
              <section>
                {pinned.length > 0 && (
                  <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Recent</p>
                )}
                <div className="space-y-0.5">{unpinned.map(renderConversation)}</div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
