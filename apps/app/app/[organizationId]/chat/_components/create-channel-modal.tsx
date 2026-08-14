"use client";

import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { Hash } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { useOrganization } from "@/hooks/organization-context";
import { errorMessage } from "@/lib/chat/types";

type CreateChannelModalProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (conversationId: Id<"conversations">) => void;
};

export function CreateChannelModal({
  isOpen,
  onOpenChange,
  onSuccess,
}: CreateChannelModalProps) {
  const { currentOrganizationId } = useOrganization();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const createChannel = useMutation(api.chat.createChannel);

  useEffect(() => {
    if (!isOpen) setName("");
  }, [isOpen]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!currentOrganizationId || !name.trim()) return;

    setSubmitting(true);
    try {
      const conversationId = await createChannel({
        organizationId: currentOrganizationId,
        name: name.trim(),
        scope: "organization",
      });
      toast({ title: "Official channel created" });
      onOpenChange(false);
      onSuccess?.(conversationId);
    } catch (error: unknown) {
      toast({
        title: "Could not create channel",
        description: errorMessage(error, "Please try again."),
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Hash className="h-5 w-5" />
            Create official channel
          </DialogTitle>
          <DialogDescription>
            Official channels are visible to active organization members, who can
            discover and join them.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-2 py-4">
            <Label htmlFor="channelName">Channel name</Label>
            <Input
              id="channelName"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. company-updates"
              maxLength={80}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Owner, Admin, and HR can manage official channels.
            </p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || submitting}>
              {submitting ? "Creating…" : "Create channel"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
