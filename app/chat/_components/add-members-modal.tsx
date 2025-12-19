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

interface AddMembersModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  existingParticipantIds: string[];
  onSuccess?: () => void;
}

export function AddMembersModal({
  isOpen,
  onOpenChange,
  conversationId,
  existingParticipantIds,
  onSuccess,
}: AddMembersModalProps) {
  const { currentOrganizationId } = useOrganization();
  const { toast } = useToast();
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  const organizationUsers = useQuery(
    (api as any).chat.getOrganizationUsers,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip"
  );

  const addMembersMutation = useMutation((api as any).chat.addMembersToGroup);

  // Filter out users who are already participants
  const availableUsers = organizationUsers?.filter(
    (user: any) => !existingParticipantIds.includes(user._id)
  );

  const filteredUsers = availableUsers?.filter((user: any) => {
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
    if (!conversationId || selectedUsers.length === 0) {
      toast({
        title: "Validation Error",
        description: "Please select at least one member to add",
        variant: "destructive",
      });
      return;
    }

    try {
      await addMembersMutation({
        conversationId: conversationId as Id<"conversations">,
        participantIds: selectedUsers.map((id) => id as Id<"users">),
      });

      toast({
        title: "Success",
        description: `${selectedUsers.length} member(s) added successfully`,
      });

      setSelectedUsers([]);
      setSearchQuery("");
      onOpenChange(false);
      onSuccess?.();
    } catch (error: any) {
      console.error("Error adding members:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to add members",
        variant: "destructive",
      });
    }
  };

  useEffect(() => {
    if (!isOpen) {
      setSelectedUsers([]);
      setSearchQuery("");
    }
  }, [isOpen]);

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Members</DialogTitle>
          <DialogDescription>
            Add members to this group chat from your organization.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label>Select Members</Label>
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
                      : availableUsers?.length === 0
                        ? "All organization members are already in this group"
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
            <Button type="submit" disabled={selectedUsers.length === 0}>
              Add Members
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
