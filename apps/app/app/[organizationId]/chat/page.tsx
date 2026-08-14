"use client";

import { useState, useEffect } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { MainLayout } from "@/components/layout/main-layout";
import { useOrganization } from "@/hooks/organization-context";
import { ConversationList } from "./_components/conversation-list";
import { ChatArea } from "./_components/chat-area";
import dynamic from "next/dynamic";
import { ChevronLeft } from "lucide-react";
import { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { ChatSessionKeysProvider } from "./_components/chat-session-keys-context";
import { directConversationTitle } from "@/lib/chat-thread-display";
import type { ChatConversation } from "@/lib/chat/types";

const NewChatModal = dynamic(
  () => import("./_components/new-chat-modal").then((m) => m.NewChatModal),
  { ssr: false },
);
const CreateGroupChatModal = dynamic(
  () =>
    import("./_components/create-group-chat-modal").then(
      (m) => m.CreateGroupChatModal,
    ),
  { ssr: false },
);
const CreateChannelModal = dynamic(
  () => import("./_components/create-channel-modal").then((m) => m.CreateChannelModal),
  { ssr: false },
);
const AddMembersModal = dynamic(
  () => import("./_components/add-members-modal").then((m) => m.AddMembersModal),
  { ssr: false },
);
const BrowseChannelsModal = dynamic(
  () =>
    import("./_components/browse-channels-modal").then(
      (module) => module.BrowseChannelsModal,
    ),
  { ssr: false },
);

// Breakpoint: below this width we show list first, then chat (mobile/tablet)
const LIST_OR_CHAT_BREAKPOINT_PX = 1024;

const CONVERSATION_PARAM = "conversation";
const DM_PARAM = "dm";
const DM_AS_ADMIN_PARAM = "dmAdmin";

export default function ChatPage() {
  const { effectiveOrganizationId } = useOrganization();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // URL is source of truth so selection persists on refresh and back/forward
  const selectedConversationId = searchParams.get(CONVERSATION_PARAM) ?? null;
  const selectedPendingParticipantId = searchParams.get(DM_PARAM) ?? null;
  const pendingDmAsAdmin = searchParams.get(DM_AS_ADMIN_PARAM) === "1";

  const [newChatOpen, setNewChatOpen] = useState(false);
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [createChannelOpen, setCreateChannelOpen] = useState(false);
  const [addMembersOpen, setAddMembersOpen] = useState(false);
  const [browseChannelsOpen, setBrowseChannelsOpen] = useState(false);

  const user = useQuery(
    api.organizations.getCurrentUser,
    effectiveOrganizationId
      ? { organizationId: effectiveOrganizationId }
      : "skip",
  );

  const selectedConversation = useQuery(
    api.chat.getConversationById,
    effectiveOrganizationId && selectedConversationId
      ? {
          organizationId: effectiveOrganizationId,
          conversationId: selectedConversationId as Id<"conversations">,
        }
      : "skip",
  );

  const pendingParticipantUser = useQuery(
    api.organizations.getUserById,
    effectiveOrganizationId && selectedPendingParticipantId
      ? {
          userId: selectedPendingParticipantId as Id<"users">,
          organizationId: effectiveOrganizationId,
        }
      : "skip",
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

  const setUrlParams = (
    conversation: string | null,
    dm: string | null,
    dmAsAdmin?: boolean,
  ) => {
    const params = new URLSearchParams();
    if (conversation) params.set(CONVERSATION_PARAM, conversation);
    if (dm) {
      params.set(DM_PARAM, dm);
      if (dmAsAdmin) params.set(DM_AS_ADMIN_PARAM, "1");
    }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const handleSelectConversation = (id: Id<"conversations">) => {
    setUrlParams(id, null);
  };

  const handleSelectParticipant = (
    participantId: string,
    options?: { asAdmin?: boolean },
  ) => {
    setUrlParams(null, participantId, options?.asAdmin);
    setNewChatOpen(false);
  };

  const handleBackToList = () => {
    setUrlParams(null, null);
  };

  const handleCloseConversation = () => {
    setUrlParams(null, null);
  };

  const handleFirstMessageSent = (conversationId: Id<"conversations">) => {
    setUrlParams(conversationId, null);
  };

  const handleSuccessGroup = (id: Id<"conversations">) => {
    setUrlParams(id, null);
    setCreateGroupOpen(false);
  };

  const handleSuccessChannel = (id: Id<"conversations">) => {
    setUrlParams(id, null);
    setCreateChannelOpen(false);
  };

  if (!effectiveOrganizationId) return null;

  // Small screen: show either list (first) or chat (when a conversation or pending DM is selected)
  const hasSelection = Boolean(
    selectedConversationId || selectedPendingParticipantId,
  );
  const showList = !isSmallScreen || !hasSelection;
  const showChat = !isSmallScreen || hasSelection;

  return (
    <MainLayout>
      <ChatSessionKeysProvider organizationId={effectiveOrganizationId}>
      {/* relative so absolute sidebar is contained below the main app header */}
      <div className="relative flex h-full min-h-0 w-full flex-1 items-stretch overflow-hidden bg-gray-50 border-t border-gray-200">
        {/* Conversation list: full width on small screen when visible, sticks to sidebar on large (no margin) */}
        <aside
          className={`
            ${showList ? "flex" : "hidden"} lg:flex
            flex-col h-full min-h-0 shrink-0
            w-full lg:w-80
            absolute lg:relative inset-0 z-10 lg:z-auto
            bg-white
          `}
        >
          <ConversationList
            selectedConversationId={selectedConversationId}
            onSelectConversation={handleSelectConversation}
            onNewChat={() => setNewChatOpen(true)}
            onCreateGroupChat={() => setCreateGroupOpen(true)}
            onCreateChannel={
              user?.role === "owner" || user?.role === "admin" || user?.role === "hr"
                ? () => setCreateChannelOpen(true)
                : undefined
            }
            onBrowseChannels={() => setBrowseChannelsOpen(true)}
            currentUserId={user?._id}
          />
        </aside>

        {/* Full-height column divider (dedicated strut so the line meets the bottom; border-l on main could clip short) */}
        <div
          className="hidden lg:block w-px shrink-0 self-stretch bg-gray-300"
          aria-hidden
        />

        {/* Chat area: replaces list view on small screen when a conversation is selected */}
        <main
          className={`
            ${showChat ? "flex" : "hidden"} lg:flex
            flex-1 flex-col min-w-0 min-h-0
            relative min-h-0
            h-full
            bg-gray-50
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
                      : directConversationTitle(
                            selectedConversation as ChatConversation,
                          user?._id,
                        )
                  : pendingParticipantUser
                    ? directConversationTitle(
                        {
                          type: "direct",
                          participants: [pendingParticipantUser],
                          directThreadKind: pendingDmAsAdmin
                            ? "staff_as_admin"
                            : undefined,
                          adminPersonaUserId: pendingDmAsAdmin
                            ? user?._id
                            : undefined,
                        },
                        user?._id,
                      )
                    : "New message"}
              </span>
            </div>
          )}
          <ChatArea
            key={
              selectedConversationId ??
              (selectedPendingParticipantId
                ? `pending:${selectedPendingParticipantId}:${pendingDmAsAdmin}`
                : "empty")
            }
            conversationId={selectedConversationId}
            conversation={(selectedConversation as ChatConversation | null | undefined) ?? null}
            currentUserId={user?._id}
            pendingParticipant={
              selectedPendingParticipantId && pendingParticipantUser
                ? { _id: pendingParticipantUser._id, name: pendingParticipantUser.name, email: pendingParticipantUser.email }
                : undefined
            }
            pendingAsAdmin={Boolean(
              selectedPendingParticipantId && pendingDmAsAdmin,
            )}
            onFirstMessageSent={handleFirstMessageSent}
            onAddMembers={
              selectedConversation?.type === "group" ||
              (selectedConversation?.type === "channel" &&
                (user?.role === "owner" ||
                  user?.role === "admin" ||
                  user?.role === "hr"))
                ? () => setAddMembersOpen(true)
                : undefined
            }
            onCloseConversation={handleCloseConversation}
            onConversationUnavailable={() => {
              setUrlParams(null, null);
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
      <BrowseChannelsModal
        organizationId={effectiveOrganizationId}
        open={browseChannelsOpen}
        onOpenChange={setBrowseChannelsOpen}
        onJoined={(id) => {
          setUrlParams(id, null);
          setBrowseChannelsOpen(false);
        }}
      />
      {selectedConversationId && (
        <AddMembersModal
          isOpen={addMembersOpen}
          onOpenChange={setAddMembersOpen}
          conversationId={selectedConversationId}
          existingParticipantIds={
            selectedConversation?.participants?.flatMap((participant) =>
              participant ? [participant._id] : [],
            ) ?? []
          }
        />
      )}
    </MainLayout>
  );
}
