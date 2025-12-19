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

interface CreateGroupChatModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (conversationId: string) => void;
}

export function CreateGroupChatModal({
  isOpen,
  onOpenChange,
  onSuccess,
}: CreateGroupChatModalProps) {
  const { currentOrganizationId } = useOrganization();
  const { toast } = useToast();
  const [groupName, setGroupName] = useState("");
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  const organizationUsers = useQuery(
    (api as any).chat.getOrganizationUsers,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip"
  );

  const createGroupChatMutation = useMutation(
    (api as any).chat.createGroupChat
  );

  const filteredUsers = organizationUsers?.filter((user: any) => {
    if (!searchQuery) return true;
    const searchLower = searchQuery.toLowerCase();
    return (
      user.name?.toLowerCase().includes(searchLower) ||
      user.email?.toLowerCase().includes(searchLower)
    );
  });

  const toggleUser = (userId: string) => {
    setSelectedUsers((prev) =>
      prev.includes(userId)
        ? prev.filter((id) => id !== userId)
        : [...prev, userId]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      !currentOrganizationId ||
      !groupName.trim() ||
      selectedUsers.length === 0
    ) {
      toast({
        title: "Validation Error",
        description:
          "Please provide a group name and select at least one member",
        variant: "destructive",
      });
      return;
    }

    try {
      const conversationId = await createGroupChatMutation({
        organizationId: currentOrganizationId,
        name: groupName.trim(),
        participantIds: selectedUsers.map((id) => id as Id<"users">),
      });

      toast({
        title: "Success",
        description: "Group chat created successfully",
      });

      setGroupName("");
      setSelectedUsers([]);
      setSearchQuery("");
      onOpenChange(false);
      onSuccess?.(conversationId);
    } catch (error: any) {
      console.error("Error creating group chat:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to create group chat",
        variant: "destructive",
      });
    }
  };

  useEffect(() => {
    if (!isOpen) {
      setGroupName("");
      setSelectedUsers([]);
      setSearchQuery("");
    }
  }, [isOpen]);

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Group Chat</DialogTitle>
          <DialogDescription>
            Create a new group chat and add members from your organization.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="groupName">Group Name *</Label>
              <Input
                id="groupName"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="Enter group name"
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Select Members *</Label>
              <Input
                placeholder="Search members..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="mb-2"
              />
              <div className="max-h-64 overflow-y-auto border rounded-md p-2 space-y-2">
                {filteredUsers && filteredUsers.length > 0 ? (
                  <>
                    <div className="flex items-center justify-between mb-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          if (selectedUsers.length === filteredUsers.length) {
                            setSelectedUsers([]);
                          } else {
                            setSelectedUsers(
                              filteredUsers.map((u: any) => u._id)
                            );
                          }
                        }}
                      >
                        {selectedUsers.length === filteredUsers.length
                          ? "Deselect All"
                          : "Select All"}
                      </Button>
                    </div>
                    {filteredUsers.map((user: any) => (
                      <label
                        key={user._id}
                        className="flex items-center gap-2 p-2 hover:bg-gray-50 rounded cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selectedUsers.includes(user._id)}
                          onChange={() => toggleUser(user._id)}
                          className="h-4 w-4 accent-purple-600"
                        />
                        <Avatar className="h-8 w-8">
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
                          <div className="text-xs text-gray-500">
                            {user.email}
                          </div>
                        </div>
                      </label>
                    ))}
                  </>
                ) : (
                  <p className="text-sm text-gray-500 p-2">
                    {searchQuery
                      ? "No members found matching your search"
                      : "No members available"}
                  </p>
                )}
              </div>
              {selectedUsers.length > 0 && (
                <p className="text-sm text-gray-500">
                  {selectedUsers.length} member(s) selected
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!groupName.trim() || selectedUsers.length === 0}
            >
              Create Group Chat
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
