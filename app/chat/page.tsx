"use client";

import { useState, useEffect, lazy, Suspense } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useSearchParams, useRouter } from "next/navigation";
import { MainLayout } from "@/components/layout/main-layout";
import { useOrganization } from "@/hooks/organization-context";
import { Id } from "@/convex/_generated/dataModel";
import { chatCache } from "@/lib/chat-cache";
import { ConversationList } from "./_components/conversation-list";
import { ChatArea } from "./_components/chat-area";

// Lazy load modals
const CreateGroupChatModal = lazy(() =>
  import("./_components/create-group-chat-modal").then((mod) => ({
    default: mod.CreateGroupChatModal,
  }))
);

const AddMembersModal = lazy(() =>
  import("./_components/add-members-modal").then((mod) => ({
    default: mod.AddMembersModal,
  }))
);

const NewChatModal = lazy(() =>
  import("./_components/new-chat-modal").then((mod) => ({
    default: mod.NewChatModal,
  }))
);

export default function ChatPage() {
  const { currentOrganizationId } = useOrganization();
  const searchParams = useSearchParams();
  const router = useRouter();
  const employeeIdParam = searchParams.get("employeeId");

  const [selectedConversationId, setSelectedConversationId] = useState<
    string | null
  >(null);
  const [isGroupChatModalOpen, setIsGroupChatModalOpen] = useState(false);
  const [isAddMembersModalOpen, setIsAddMembersModalOpen] = useState(false);
  const [isNewChatModalOpen, setIsNewChatModalOpen] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [cacheInitialized, setCacheInitialized] = useState(false);

  const user = useQuery((api as any).organizations.getCurrentUser, {
    organizationId: currentOrganizationId || undefined,
  });

  const conversationsData = useQuery(
    (api as any).chat.getConversations,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip"
  );

  const conversations = conversationsData?.conversations || [];

  const getOrCreateConversationMutation = useMutation(
    (api as any).chat.getOrCreateConversation
  );

  const employeeUser = useQuery(
    (api as any).chat.getUserByEmployeeId,
    employeeIdParam && currentOrganizationId
      ? {
          organizationId: currentOrganizationId,
          employeeId: employeeIdParam as Id<"employees">,
        }
      : "skip"
  );

  // Initialize IndexedDB cache
  useEffect(() => {
    if (currentOrganizationId && !cacheInitialized) {
      chatCache
        .initialize(currentOrganizationId)
        .then(() => {
          setCacheInitialized(true);
        })
        .catch((error) => {
          console.error("Error initializing chat cache:", error);
        });
    }
  }, [currentOrganizationId, cacheInitialized]);

  // Cache conversations when they update
  useEffect(() => {
    if (conversations && conversations.length > 0 && cacheInitialized) {
      chatCache.cacheConversations(conversations).catch((error) => {
        console.error("Error caching conversations:", error);
      });
    }
  }, [conversations, cacheInitialized]);

  // Initialize conversation from employeeId parameter
  useEffect(() => {
    if (
      employeeIdParam &&
      currentOrganizationId &&
      employeeUser &&
      !isInitializing &&
      !selectedConversationId
    ) {
      setIsInitializing(true);
      getOrCreateConversationMutation({
        organizationId: currentOrganizationId,
        participantId: employeeUser._id,
      })
        .then((conversationId) => {
          setSelectedConversationId(conversationId);
        })
        .catch((error) => {
          console.error("Error initializing conversation:", error);
        })
        .finally(() => {
          setIsInitializing(false);
        });
    }
  }, [
    employeeIdParam,
    currentOrganizationId,
    employeeUser,
    isInitializing,
    selectedConversationId,
    getOrCreateConversationMutation,
  ]);

  const selectedConversation = conversations?.find(
    (conv: any) => conv._id === selectedConversationId
  );

  const handleGroupChatCreated = (conversationId: string) => {
    setSelectedConversationId(conversationId);
  };

  const handleNewChatCreated = (conversationId: string) => {
    setSelectedConversationId(conversationId);
  };

  const handleAddMembersSuccess = () => {
    // Refetch conversations to get updated participant list
    // This will happen automatically via Convex reactivity
  };

  return (
    <MainLayout>
      <div className="fixed inset-0 left-60 top-0 flex overflow-hidden bg-white">
        <ConversationList
          selectedConversationId={selectedConversationId}
          onSelectConversation={setSelectedConversationId}
          onCreateGroupChat={() => setIsGroupChatModalOpen(true)}
          onNewChat={() => setIsNewChatModalOpen(true)}
          currentUserId={user?._id}
        />

        <ChatArea
          conversationId={selectedConversationId}
          conversation={selectedConversation}
          currentUserId={user?._id}
          onAddMembers={
            selectedConversation?.type === "group"
              ? () => setIsAddMembersModalOpen(true)
              : undefined
          }
        />
      </div>

      {/* Lazy loaded modals */}
      {isGroupChatModalOpen && (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
              <div className="bg-white rounded-lg p-4">Loading...</div>
            </div>
          }
        >
          <CreateGroupChatModal
            isOpen={isGroupChatModalOpen}
            onOpenChange={setIsGroupChatModalOpen}
            onSuccess={handleGroupChatCreated}
          />
        </Suspense>
      )}

      {isAddMembersModalOpen && selectedConversationId && (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
              <div className="bg-white rounded-lg p-4">Loading...</div>
            </div>
          }
        >
          <AddMembersModal
            isOpen={isAddMembersModalOpen}
            onOpenChange={setIsAddMembersModalOpen}
            conversationId={selectedConversationId}
            existingParticipantIds={
              selectedConversation?.participants?.map((p: any) => p._id) || []
            }
            onSuccess={handleAddMembersSuccess}
          />
        </Suspense>
      )}

      {isNewChatModalOpen && (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
              <div className="bg-white rounded-lg p-4">Loading...</div>
            </div>
          }
        >
          <NewChatModal
            isOpen={isNewChatModalOpen}
            onOpenChange={setIsNewChatModalOpen}
            onSuccess={handleNewChatCreated}
          />
        </Suspense>
      )}
    </MainLayout>
  );
}
