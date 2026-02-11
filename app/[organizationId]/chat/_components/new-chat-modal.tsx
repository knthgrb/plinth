"use client";

import { useState, useEffect } from "react";
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

interface NewChatModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (conversationId: string) => void;
}

export function NewChatModal({
  isOpen,
  onOpenChange,
  onSuccess,
}: NewChatModalProps) {
  const { currentOrganizationId } = useOrganization();
  const { toast } = useToast();
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const organizationUsers = useQuery(
    (api as any).chat.getOrganizationUsers,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip"
  );

  const getOrCreateConversationMutation = useMutation(
    (api as any).chat.getOrCreateConversation
  );

  const filteredUsers = organizationUsers?.filter((user: any) => {
    if (!searchQuery) return true;
    const searchLower = searchQuery.toLowerCase();
    return (
      user.name?.toLowerCase().includes(searchLower) ||
      user.email?.toLowerCase().includes(searchLower)
    );
  });

  const handleStartChat = async (userId: string) => {
    if (!currentOrganizationId) return;

    try {
      const conversationId = await getOrCreateConversationMutation({
        organizationId: currentOrganizationId,
        participantId: userId as Id<"users">,
      });

      setSelectedUserId(null);
      setSearchQuery("");
      onOpenChange(false);
      onSuccess?.(conversationId);
    } catch (error: any) {
      console.error("Error starting chat:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to start chat",
        variant: "destructive",
      });
    }
  };

  useEffect(() => {
    if (!isOpen) {
      setSelectedUserId(null);
      setSearchQuery("");
    }
  }, [isOpen]);

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Chat</DialogTitle>
          <DialogDescription>
            Start a conversation with someone from your organization.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
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
                filteredUsers.map((user: any) => (
                  <button
                    key={user._id}
                    onClick={() => handleStartChat(user._id)}
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
