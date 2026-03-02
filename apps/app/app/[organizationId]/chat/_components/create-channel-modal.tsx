"use client";

import { useState, useEffect } from "react";
import { useMutation } from "convex/react";
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
import { useOrganization } from "@/hooks/organization-context";
import { Id } from "@/convex/_generated/dataModel";
import { useToast } from "@/components/ui/use-toast";
import { Hash } from "lucide-react";

interface CreateChannelModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (conversationId: string) => void;
}

export function CreateChannelModal({
  isOpen,
  onOpenChange,
  onSuccess,
}: CreateChannelModalProps) {
  const { currentOrganizationId } = useOrganization();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"organization" | "personal">("organization");

  const createChannelMutation = useMutation((api as any).chat.createChannel);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentOrganizationId || !name.trim()) {
      toast({
        title: "Validation Error",
        description: "Please enter a channel name",
        variant: "destructive",
      });
      return;
    }

    try {
      const conversationId = await createChannelMutation({
        organizationId: currentOrganizationId as Id<"organizations">,
        name: name.trim(),
        scope,
      });

      toast({
        title: "Success",
        description: "Channel created successfully",
      });

      setName("");
      setScope("organization");
      onOpenChange(false);
      onSuccess?.(conversationId);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to create channel",
        variant: "destructive",
      });
    }
  };

  useEffect(() => {
    if (!isOpen) {
      setName("");
      setScope("organization");
    }
  }, [isOpen]);

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Hash className="h-5 w-5" />
            Create a Channel
          </DialogTitle>
          <DialogDescription>
            Channels can be visible to the whole organization or just for you (personal).
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="channelName">Channel name <span className="text-red-500">*</span></Label>
              <Input
                id="channelName"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. daily team huddle"
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Scope</Label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="scope"
                    checked={scope === "organization"}
                    onChange={() => setScope("organization")}
                    className="accent-[#695eff]"
                  />
                  <span className="text-sm">Organization</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="scope"
                    checked={scope === "personal"}
                    onChange={() => setScope("personal")}
                    className="accent-[#695eff]"
                  />
                  <span className="text-sm">Personal</span>
                </label>
              </div>
              <p className="text-xs text-gray-500">
                {scope === "organization"
                  ? "Any org member can discover and join this channel."
                  : "Only you and people you add will be in this channel."}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim()}>
              Create Channel
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
