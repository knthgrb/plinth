"use client";

import { useState, useEffect } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { MainLayout } from "@/components/layout/main-layout";
import { useOrganization } from "@/hooks/organization-context";
import { ConversationList } from "./_components/conversation-list";
import { ChatArea } from "./_components/chat-area";
import { NewChatModal } from "./_components/new-chat-modal";
import { CreateGroupChatModal } from "./_components/create-group-chat-modal";
import { CreateChannelModal } from "./_components/create-channel-modal";
import { AddMembersModal } from "./_components/add-members-modal";
import { ChevronLeft } from "lucide-react";
import { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { chatCache } from "@/services/chat-cache-service";
import { ChatSessionKeysProvider } from "./_components/chat-session-keys-context";

// Breakpoint: below this width we show list first, then chat (mobile/tablet)
const LIST_OR_CHAT_BREAKPOINT_PX = 1024;

const CONVERSATION_PARAM = "conversation";
const DM_PARAM = "dm";

export default function ChatPage() {
  const { currentOrganizationId } = useOrganization();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // URL is source of truth so selection persists on refresh and back/forward
  const selectedConversationId = searchParams.get(CONVERSATION_PARAM) ?? null;
  const selectedPendingParticipantId = searchParams.get(DM_PARAM) ?? null;

  const [newChatOpen, setNewChatOpen] = useState(false);
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [createChannelOpen, setCreateChannelOpen] = useState(false);
  const [addMembersOpen, setAddMembersOpen] = useState(false);
  const [listOrChatMode, setListOrChatMode] = useState(true); // true = show list first on small screens

  const user = useQuery(
    (api as any).organizations.getCurrentUser,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip"
  );

  const selectedConversation = useQuery(
    (api as any).chat.getConversationById,
    currentOrganizationId && selectedConversationId
      ? {
          organizationId: currentOrganizationId,
          conversationId: selectedConversationId,
        }
      : "skip"
  );

  const pendingParticipantUser = useQuery(
    (api as any).organizations.getUserById,
    currentOrganizationId && selectedPendingParticipantId
      ? {
          userId: selectedPendingParticipantId as Id<"users">,
          organizationId: currentOrganizationId,
        }
      : "skip"
  );

  // Detect small screen (mobile/tablet): conversations first, then chat replaces list when selected.
  // Default true so mobile gets full-width list on first paint (no two-column flash).
  const [isSmallScreen, setIsSmallScreen] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${LIST_OR_CHAT_BREAKPOINT_PX - 1}px)`);
    const handle = () => setIsSmallScreen(mq.matches);
    handle();
    mq.addEventListener("change", handle);
    return () => mq.removeEventListener("change", handle);
  }, []);

  // On small screen, when a conversation or pending DM is in URL, show chat view
  useEffect(() => {
    if (isSmallScreen && (selectedConversationId || selectedPendingParticipantId))
      setListOrChatMode(false);
  }, [isSmallScreen, selectedConversationId, selectedPendingParticipantId]);

  // Initialize IndexedDB cache with encryption for this org
  useEffect(() => {
    if (currentOrganizationId) {
      chatCache.initialize(currentOrganizationId).catch(console.error);
    }
  }, [currentOrganizationId]);

  const setUrlParams = (conversation: string | null, dm: string | null) => {
    const params = new URLSearchParams();
    if (conversation) params.set(CONVERSATION_PARAM, conversation);
    if (dm) params.set(DM_PARAM, dm);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const handleSelectConversation = (id: string) => {
    setUrlParams(id, null);
    if (isSmallScreen) setListOrChatMode(false);
  };

  const handleSelectParticipant = (participantId: string) => {
    setUrlParams(null, participantId);
    setNewChatOpen(false);
    if (isSmallScreen) setListOrChatMode(false);
  };

  const handleBackToList = () => {
    setListOrChatMode(true);
    setUrlParams(null, null);
  };

  const handleCloseConversation = () => {
    setUrlParams(null, null);
    if (isSmallScreen) setListOrChatMode(true);
  };

  const handleFirstMessageSent = (conversationId: string) => {
    setUrlParams(conversationId, null);
  };

  const handleSuccessNewChat = (id: string) => {
    setUrlParams(id, null);
    setNewChatOpen(false);
    if (isSmallScreen) setListOrChatMode(false);
  };

  const handleSuccessGroup = (id: string) => {
    setUrlParams(id, null);
    setCreateGroupOpen(false);
    if (isSmallScreen) setListOrChatMode(false);
  };

  const handleSuccessChannel = (id: string) => {
    setUrlParams(id, null);
    setCreateChannelOpen(false);
    if (isSmallScreen) setListOrChatMode(false);
  };

  if (!currentOrganizationId) return null;

  // Small screen: show either list (first) or chat (when a conversation or pending DM is selected)
  const showList = !isSmallScreen || listOrChatMode;
  const showChat = !isSmallScreen || !listOrChatMode || !!selectedPendingParticipantId;

  return (
    <MainLayout>
      <ChatSessionKeysProvider organizationId={currentOrganizationId}>
      {/* relative so absolute sidebar is contained below the main app header */}
      <div className="relative flex h-[calc(100vh-4rem)] min-h-0 overflow-hidden w-full bg-gray-50">
        {/* Conversation list: full width on small screen when visible, sticks to sidebar on large (no margin) */}
        <aside
          className={`
            ${showList ? "flex" : "hidden"} lg:flex
            flex-col h-full shrink-0
            w-full lg:w-80
            absolute lg:relative inset-0 z-10 lg:z-auto
            bg-white border-r border-[rgb(230,230,230)]
          `}
        >
          <ConversationList
            selectedConversationId={selectedConversationId}
            onSelectConversation={handleSelectConversation}
            onNewChat={() => setNewChatOpen(true)}
            onCreateGroupChat={() => setCreateGroupOpen(true)}
            onCreateChannel={() => setCreateChannelOpen(true)}
            currentUserId={user?._id}
          />
        </aside>

        {/* Full-height divider between list and chat (desktop only); absolute so it always reaches bottom */}
        <div
          className="hidden lg:block absolute top-0 bottom-0 w-px bg-gray-200 pointer-events-none z-10"
          style={{ left: "20rem" }}
          aria-hidden="true"
        />

        {/* Chat area: replaces list view on small screen when a conversation is selected */}
        <main
          className={`
            ${showChat ? "flex" : "hidden"} lg:flex
            flex-1 flex-col min-w-0 min-h-0
            relative bg-gray-50
          `}
        >
          {isSmallScreen && showChat && (
            <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-gray-200 bg-white">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleBackToList}
                aria-label="Back to conversations"
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <span className="text-sm font-medium text-gray-700 truncate">
                {selectedConversation
                  ? selectedConversation.type === "channel"
                    ? `# ${selectedConversation.name}`
                    : selectedConversation.type === "group"
                      ? selectedConversation.name
                      : selectedConversation.participants?.[0]?.name ||
                        selectedConversation.participants?.[0]?.email
                  : pendingParticipantUser?.name || pendingParticipantUser?.email || "New message"}
              </span>
            </div>
          )}
          <ChatArea
            conversationId={selectedConversationId}
            conversation={selectedConversation ?? null}
            currentUserId={user?._id}
            pendingParticipant={
              selectedPendingParticipantId && pendingParticipantUser
                ? { _id: pendingParticipantUser._id, name: pendingParticipantUser.name, email: pendingParticipantUser.email }
                : undefined
            }
            onFirstMessageSent={handleFirstMessageSent}
            onAddMembers={
              selectedConversation?.type === "group" ||
              selectedConversation?.type === "channel"
                ? () => setAddMembersOpen(true)
                : undefined
            }
            onCloseConversation={handleCloseConversation}
            onDeleteConversation={(id) => {
              if (selectedConversationId === id) {
                setUrlParams(null, null);
                if (isSmallScreen) setListOrChatMode(true);
              }
            }}
          />
        </main>

      </div>
      </ChatSessionKeysProvider>

      <NewChatModal
        isOpen={newChatOpen}
        onOpenChange={setNewChatOpen}
        onSelectParticipant={handleSelectParticipant}
      />
      <CreateGroupChatModal
        isOpen={createGroupOpen}
        onOpenChange={setCreateGroupOpen}
        onSuccess={handleSuccessGroup}
      />
      <CreateChannelModal
        isOpen={createChannelOpen}
        onOpenChange={setCreateChannelOpen}
        onSuccess={handleSuccessChannel}
      />
      {selectedConversationId && (
        <AddMembersModal
          isOpen={addMembersOpen}
          onOpenChange={setAddMembersOpen}
          conversationId={selectedConversationId}
          existingParticipantIds={
            selectedConversation?.participants?.map((p: any) => p._id) ?? []
          }
        />
      )}
    </MainLayout>
  );
}
