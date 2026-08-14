"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useOrganization } from "@/hooks/organization-context";
import { Id } from "@/convex/_generated/dataModel";
import { useToast } from "@/components/ui/use-toast";
import { errorMessage } from "@/lib/chat/types";

interface NewChatModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called when user selects someone to message. Conversation is not created until they send the first message. */
  onSelectParticipant?: (
    participantId: string,
    options?: { asAdmin?: boolean },
  ) => void;
  /** @deprecated Use onSelectParticipant; conversation is created on first message send. */
  onSuccess?: (conversationId: string) => void;
}

export function NewChatModal({
  isOpen,
  onOpenChange,
  onSelectParticipant,
  onSuccess,
}: NewChatModalProps) {
  const { currentOrganizationId } = useOrganization();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [messageAs, setMessageAs] = useState<"self" | "admin">("self");

  const currentUser = useQuery(
    api.organizations.getCurrentUser,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip",
  );

  const organizationUsers = useQuery(
    api.chat.getOrganizationUsers,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip"
  );

  const canMessageAsAdmin =
    currentUser?.role === "owner" ||
    currentUser?.role === "admin" ||
    currentUser?.role === "hr";

  const getOrCreateConversationMutation = useMutation(
    api.chat.getOrCreateConversation,
  );

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setSearchQuery("");
      setMessageAs("self");
    }
    onOpenChange(open);
  };

  const filteredUsers = organizationUsers?.filter((user) => {
    if (!searchQuery) return true;
    const searchLower = searchQuery.toLowerCase();
    return (
      user.name?.toLowerCase().includes(searchLower) ||
      user.email?.toLowerCase().includes(searchLower)
    );
  });

  const handleSelectUser = (userId: string) => {
    setSearchQuery("");
    handleOpenChange(false);
    if (onSelectParticipant) {
      onSelectParticipant(userId, {
        asAdmin: canMessageAsAdmin && messageAs === "admin",
      });
    } else if (onSuccess) {
      // Legacy: create conversation immediately (e.g. from other entry points)
      getOrCreateConversationMutation({
        organizationId: currentOrganizationId!,
        participantId: userId as Id<"users">,
        directThreadKind:
          canMessageAsAdmin && messageAs === "admin"
            ? "staff_as_admin"
            : "standard",
      })
        .then(onSuccess)
        .catch((error: unknown) => {
          toast({
            title: "Error",
            description: errorMessage(error, "Failed to start chat"),
            variant: "destructive",
          });
        });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Chat</DialogTitle>
          <DialogDescription>
            Start a conversation with someone from your organization.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          {canMessageAsAdmin && (
            <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50/80 p-3 space-y-2">
              <Label className="text-gray-900">Message as</Label>
              <p className="text-xs text-gray-500">
                Admin threads are separate from your personal DM with the same
                person. They only see &quot;Admin&quot; as the sender name.
              </p>
              <div className="flex rounded-md border border-gray-200 bg-white p-0.5 gap-0.5">
                <Button
                  type="button"
                  variant={messageAs === "self" ? "default" : "ghost"}
                  size="sm"
                  className="flex-1 rounded-sm"
                  onClick={() => setMessageAs("self")}
                >
                  Yourself
                </Button>
                <Button
                  type="button"
                  variant={messageAs === "admin" ? "default" : "ghost"}
                  size="sm"
                  className="flex-1 rounded-sm"
                  onClick={() => setMessageAs("admin")}
                >
                  Admin
                </Button>
              </div>
            </div>
          )}
          <div className="space-y-2">
            <Label>Search Members</Label>
            <Input
              placeholder="Search by name or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="mb-2"
            />
            <div className="max-h-96 overflow-y-auto border rounded-md p-2 space-y-1">
              {filteredUsers && filteredUsers.length > 0 ? (
                filteredUsers.map((user) => (
                  <button
                    key={user._id}
                    onClick={() => handleSelectUser(user._id)}
                    className="w-full flex items-center gap-2 p-2 hover:bg-gray-50 rounded cursor-pointer text-left"
                  >
                    <Avatar className="h-10 w-10">
                      <AvatarFallback>
                        {user.name
                          ?.split(" ")
                          .map((n: string) => n[0])
                          .join("")
                          .toUpperCase()
                          .slice(0, 2) || user.email[0].toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1">
                      <div className="text-sm font-medium">
                        {user.name || user.email}
                      </div>
                      <div className="text-xs text-gray-500">{user.email}</div>
                    </div>
                  </button>
                ))
              ) : (
                <p className="text-sm text-gray-500 p-2">
                  {searchQuery
                    ? "No members found matching your search"
                    : "No members available"}
                </p>
              )}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
