"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import {
  Pin,
  Users,
  Plus,
  MessageSquare,
  Hash,
  MoreHorizontal,
  ListFilter,
  CheckCheck,
} from "lucide-react";
import { Id } from "@/convex/_generated/dataModel";
import { useOrganization } from "@/hooks/organization-context";
import { ConversationSkeleton, ConversationListSkeleton } from "./skeletons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface ConversationListProps {
  selectedConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onCreateGroupChat: () => void;
  onNewChat: () => void;
  onCreateChannel?: () => void;
  currentUserId?: string;
}

export function ConversationList({
  selectedConversationId,
  onSelectConversation,
  onCreateGroupChat,
  onNewChat,
  onCreateChannel,
  currentUserId,
}: ConversationListProps) {
  const { currentOrganizationId } = useOrganization();
  const [cursor, setCursor] = useState<string | null>(null);
  const [allConversations, setAllConversations] = useState<any[]>([]);
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isLoadingMoreRef = useRef(false);

  const conversationsData = useQuery(
    (api as any).chat.getConversations,
    currentOrganizationId
      ? {
          organizationId: currentOrganizationId,
          limit: 20,
          cursor: cursor || undefined,
        }
      : "skip",
  );

  const pinnedConversations = useQuery(
    (api as any).chat.getPinnedConversations,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip",
  );

  const unreadCounts = useQuery(
    (api as any).chat.getUnreadCounts,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip",
  );

  const markAllReadMutation = useMutation(
    (api as any).chat.markAllConversationsAsRead,
  );

  // Update allConversations when new data arrives
  useEffect(() => {
    if (conversationsData) {
      if (cursor) {
        // Appending more conversations
        setAllConversations((prev) => [
          ...prev,
          ...conversationsData.conversations,
        ]);
      } else {
        // Initial load or reset
        setAllConversations(conversationsData.conversations);
      }
      isLoadingMoreRef.current = false;
    }
  }, [conversationsData, cursor]);

  // Reset when organization changes
  useEffect(() => {
    setAllConversations([]);
    setCursor(null);
  }, [currentOrganizationId]);

  const conversations = allConversations;
  const hasMore = conversationsData?.hasMore || false;

  const togglePinMutation = useMutation(
    (api as any).chat.togglePinConversation,
  );

  const pinnedSet = useMemo(() => {
    return new Set(pinnedConversations || []);
  }, [pinnedConversations]);

  const filteredConversations = useMemo(() => {
    if (!showUnreadOnly || !unreadCounts) return conversations;
    return conversations.filter((c: any) => (unreadCounts[c._id] || 0) > 0);
  }, [conversations, showUnreadOnly, unreadCounts]);

  // Separate pinned and unpinned conversations
  const { pinned, unpinned } = useMemo(() => {
    const list = showUnreadOnly ? filteredConversations : conversations;
    if (!list || list.length === 0) return { pinned: [], unpinned: [] };

    const pinnedList: any[] = [];
    const unpinnedList: any[] = [];

    list.forEach((conv: any) => {
      if (pinnedSet.has(conv._id)) {
        pinnedList.push(conv);
      } else {
        unpinnedList.push(conv);
      }
    });

    pinnedList.sort((a, b) => {
      const aTime = a.lastMessage?.createdAt || a.createdAt || 0;
      const bTime = b.lastMessage?.createdAt || b.createdAt || 0;
      return bTime - aTime;
    });

    return { pinned: pinnedList, unpinned: unpinnedList };
  }, [conversations, pinnedSet, showUnreadOnly, filteredConversations]);

  const handleTogglePin = async (
    e: React.MouseEvent,
    conversationId: string,
  ) => {
    e.stopPropagation();
    if (!currentOrganizationId) return;

    try {
      await togglePinMutation({
        organizationId: currentOrganizationId,
        conversationId: conversationId as Id<"conversations">,
      });
    } catch (error) {
      console.error("Error toggling pin:", error);
    }
  };

  const loadMoreRef = useRef<HTMLDivElement>(null);

  const loadMoreConversations = () => {
    if (!hasMore || isLoadingMoreRef.current || !conversationsData?.nextCursor)
      return;
    isLoadingMoreRef.current = true;
    setCursor(conversationsData.nextCursor);
  };

  // Use Intersection Observer for infinite loading
  useEffect(() => {
    const observerTarget = loadMoreRef.current;
    if (!observerTarget || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry.isIntersecting) {
          loadMoreConversations();
        }
      },
      {
        root: scrollContainerRef.current,
        rootMargin: "100px", // Start loading 100px before reaching the element
        threshold: 0.1,
      },
    );

    observer.observe(observerTarget);

    return () => {
      observer.disconnect();
    };
  }, [hasMore, conversationsData?.nextCursor]);

  const getDisplayName = (conv: any) => {
    if (conv.type === "channel") return conv.name || "Channel";
    if (conv.type === "group") return conv.name || "Group Chat";
    const otherParticipant = conv.participants?.[0];
    return otherParticipant?.name || otherParticipant?.email || "Unknown User";
  };

  const getInitials = (conv: any) => {
    if (conv.type === "channel") {
      return conv.name ? conv.name[0].toUpperCase() : "#";
    }
    if (conv.type === "group") {
      return (
        conv.name
          ?.split(" ")
          .map((n: string) => n[0])
          .join("")
          .toUpperCase()
          .slice(0, 2) || "GC"
      );
    }
    const otherParticipant = conv.participants?.[0];
    const displayName =
      otherParticipant?.name || otherParticipant?.email || "Unknown";
    return displayName
      .split(" ")
      .map((n: string) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const handleMarkAllRead = async () => {
    if (!currentOrganizationId) return;
    try {
      await markAllReadMutation({ organizationId: currentOrganizationId });
    } catch (e) {
      console.error(e);
    }
  };

  const renderConversation = (conv: any) => {
    const isSelected = selectedConversationId === conv._id;
    const isPinned = pinnedSet.has(conv._id);

    return (
      <div
        key={conv._id}
        role="button"
        tabIndex={0}
        onClick={() => onSelectConversation(conv._id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelectConversation(conv._id);
          }
        }}
        className={`w-full p-4 text-left hover:bg-gray-50 transition-colors relative cursor-pointer ${
          isSelected ? "bg-gray-100" : ""
        }`}
      >
        <div className="flex items-center gap-3">
          <Avatar>
            <AvatarFallback>
              {conv.type === "channel" ? (
                <Hash className="h-4 w-4" />
              ) : conv.type === "group" ? (
                <Users className="h-4 w-4" />
              ) : (
                getInitials(conv)
              )}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <div className="font-medium text-gray-900 truncate">
                {conv.type === "channel"
                  ? `# ${getDisplayName(conv)}`
                  : getDisplayName(conv)}
              </div>
              {unreadCounts && (unreadCounts[conv._id] || 0) > 0 && (
                <span
                  className="rounded-full bg-brand-purple text-white text-xs font-semibold min-w-[1.25rem] h-5 px-1.5 flex items-center justify-center tabular-nums"
                  aria-label={`${unreadCounts[conv._id]} unread`}
                >
                  {unreadCounts[conv._id]}
                </span>
              )}
            </div>
            {conv.lastMessage && (
              <div className="text-sm text-gray-500 truncate">
                {conv.lastMessage.content}
              </div>
            )}
          </div>
          <div
            className="flex items-center gap-2"
            onClick={(e) => e.stopPropagation()}
          >
            {conv.lastMessage && (
              <div className="text-xs text-gray-400">
                {format(new Date(conv.lastMessage.createdAt), "MMM d")}
              </div>
            )}
            <Button
              variant="ghost"
              size="sm"
              className={`h-6 w-6 p-0 rounded ${isPinned ? "bg-brand-purple/10 text-brand-purple" : ""}`}
              onClick={(e) => handleTogglePin(e, conv._id)}
            >
              <Pin
                className={`h-4 w-4 ${
                  isPinned
                    ? "fill-brand-purple text-brand-purple"
                    : "text-gray-400"
                }`}
              />
            </Button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="w-full lg:w-80 bg-white flex flex-col h-full shrink-0 min-w-0">
      <div className="flex items-center min-h-[4.5rem] h-[4.5rem] px-4 border-b border-gray-200 shrink-0">
        <div className="flex items-center justify-between gap-2 w-full min-w-0">
          <h1 className="text-xl font-bold text-gray-900 truncate">Chat</h1>
          <div className="flex items-center gap-1 shrink-0">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0"
                  aria-label="More options"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setShowUnreadOnly((v) => !v)}>
                  <ListFilter className="h-4 w-4 mr-2" />
                  {showUnreadOnly ? "Show all chats" : "View unread chats"}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleMarkAllRead}>
                  <CheckCheck className="h-4 w-4 mr-2" />
                  Mark all as read
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0"
                  aria-label="New conversation"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onNewChat}>
                  <MessageSquare className="h-4 w-4 mr-2" />
                  Send a Direct Message
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onCreateGroupChat}>
                  <Users className="h-4 w-4 mr-2" />
                  Start a Group Conversation
                </DropdownMenuItem>
                {onCreateChannel && (
                  <DropdownMenuItem onClick={onCreateChannel}>
                    <Hash className="h-4 w-4 mr-2" />
                    Create a Channel
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto min-h-0">
        {conversations === undefined ? (
          <div className="p-4 text-center text-gray-500 text-sm">
            Loading...
          </div>
        ) : (showUnreadOnly ? filteredConversations : conversations)?.length ===
          0 ? (
          <div className="p-4 text-center text-gray-500 text-sm">
            {showUnreadOnly
              ? "No unread conversations"
              : "No conversations yet"}
          </div>
        ) : (
          <div className="[&>:first-child]:border-t-0">
            {/* Pinned Conversations */}
            {pinned.length > 0 && (
              <>
                {pinned.map((conv: any) => (
                  <div key={conv._id} className="border-t border-gray-200">
                    {renderConversation(conv)}
                  </div>
                ))}
                {unpinned.length > 0 && (
                  <div className="border-t border-gray-200">
                    <div className="px-4 py-2 text-xs font-medium text-gray-500 uppercase">
                      All Conversations
                    </div>
                  </div>
                )}
              </>
            )}
            {/* Unpinned Conversations */}
            {unpinned.map((conv: any) => (
              <div key={conv._id} className="border-t border-gray-200">
                {renderConversation(conv)}
              </div>
            ))}
            {/* Intersection Observer target for infinite scroll */}
            {hasMore && (
              <div ref={loadMoreRef} className="border-t border-gray-200 p-4">
                <ConversationSkeleton />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
