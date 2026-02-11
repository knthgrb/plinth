"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { Pin, Users, Plus, MessageSquare } from "lucide-react";
import { Id } from "@/convex/_generated/dataModel";
import { useOrganization } from "@/hooks/organization-context";
import { ConversationSkeleton, ConversationListSkeleton } from "./skeletons";

interface ConversationListProps {
  selectedConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onCreateGroupChat: () => void;
  onNewChat: () => void;
  currentUserId?: string;
}

export function ConversationList({
  selectedConversationId,
  onSelectConversation,
  onCreateGroupChat,
  onNewChat,
  currentUserId,
}: ConversationListProps) {
  const { currentOrganizationId } = useOrganization();
  const [cursor, setCursor] = useState<string | null>(null);
  const [allConversations, setAllConversations] = useState<any[]>([]);
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
      : "skip"
  );

  const pinnedConversations = useQuery(
    (api as any).chat.getPinnedConversations,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip"
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
    (api as any).chat.togglePinConversation
  );

  const pinnedSet = useMemo(() => {
    return new Set(pinnedConversations || []);
  }, [pinnedConversations]);

  // Separate pinned and unpinned conversations
  const { pinned, unpinned } = useMemo(() => {
    if (!conversations || conversations.length === 0)
      return { pinned: [], unpinned: [] };

    const pinnedList: any[] = [];
    const unpinnedList: any[] = [];

    conversations.forEach((conv: any) => {
      if (pinnedSet.has(conv._id)) {
        pinnedList.push(conv);
      } else {
        unpinnedList.push(conv);
      }
    });

    // Sort pinned by last message time
    pinnedList.sort((a, b) => {
      const aTime = a.lastMessage?.createdAt || a.createdAt || 0;
      const bTime = b.lastMessage?.createdAt || b.createdAt || 0;
      return bTime - aTime;
    });

    return { pinned: pinnedList, unpinned: unpinnedList };
  }, [conversations, pinnedSet]);

  const handleTogglePin = async (
    e: React.MouseEvent,
    conversationId: string
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
      }
    );

    observer.observe(observerTarget);

    return () => {
      observer.disconnect();
    };
  }, [hasMore, conversationsData?.nextCursor]);

  const getDisplayName = (conv: any) => {
    if (conv.type === "group") {
      return conv.name || "Group Chat";
    }
    const otherParticipant = conv.participants?.[0];
    return otherParticipant?.name || otherParticipant?.email || "Unknown User";
  };

  const getInitials = (conv: any) => {
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

  const renderConversation = (conv: any) => {
    const isSelected = selectedConversationId === conv._id;
    const isPinned = pinnedSet.has(conv._id);

    return (
      <button
        key={conv._id}
        onClick={() => onSelectConversation(conv._id)}
        className={`w-full p-4 text-left hover:bg-gray-50 transition-colors relative ${
          isSelected ? "bg-purple-50 border-l-4 border-purple-600" : ""
        }`}
      >
        <div className="flex items-center gap-3">
          <Avatar>
            <AvatarFallback>
              {conv.type === "group" ? (
                <Users className="h-4 w-4" />
              ) : (
                getInitials(conv)
              )}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <div className="font-medium text-gray-900 truncate">
                {getDisplayName(conv)}
              </div>
              {conv.type === "group" && (
                <span className="text-xs text-gray-500">
                  {conv.participants?.length || 0} members
                </span>
              )}
            </div>
            {conv.lastMessage && (
              <div className="text-sm text-gray-500 truncate">
                {conv.lastMessage.content}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {conv.lastMessage && (
              <div className="text-xs text-gray-400">
                {format(new Date(conv.lastMessage.createdAt), "MMM d")}
              </div>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={(e) => handleTogglePin(e, conv._id)}
            >
              <Pin
                className={`h-4 w-4 ${
                  isPinned ? "fill-purple-600 text-purple-600" : "text-gray-400"
                }`}
              />
            </Button>
          </div>
        </div>
      </button>
    );
  };

  return (
    <div className="w-80 border-r border-gray-200 bg-white flex flex-col h-full shrink-0">
      <div className="p-4 border-b border-gray-200 shrink-0">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">Messages</h1>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={onNewChat}
              className="h-8 w-8 p-0"
              title="New Chat"
            >
              <MessageSquare className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onCreateGroupChat}
              className="h-8 w-8 p-0"
              title="Create Group Chat"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto min-h-0">
        {conversations === undefined ? (
          <div className="p-4 text-center text-gray-500 text-sm">
            Loading...
          </div>
        ) : conversations?.length === 0 ? (
          <div className="p-4 text-center text-gray-500 text-sm">
            No conversations yet
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {/* Pinned Conversations */}
            {pinned.length > 0 && (
              <>
                {pinned.map((conv: any) => renderConversation(conv))}
                {unpinned.length > 0 && (
                  <div className="px-4 py-2 text-xs font-medium text-gray-500 uppercase">
                    All Conversations
                  </div>
                )}
              </>
            )}
            {/* Unpinned Conversations */}
            {unpinned.map((conv: any) => renderConversation(conv))}
            {/* Intersection Observer target for infinite scroll */}
            {hasMore && (
              <div ref={loadMoreRef} className="p-4">
                <ConversationSkeleton />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
