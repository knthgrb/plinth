"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Hash, Loader2, Search, Users } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import type { ChatChannel } from "@/lib/chat/types";
import { errorMessage } from "@/lib/chat/types";

type BrowseChannelsModalProps = {
  organizationId: Id<"organizations">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onJoined: (conversationId: Id<"conversations">) => void;
};

export function BrowseChannelsModal({
  organizationId,
  open,
  onOpenChange,
  onJoined,
}: BrowseChannelsModalProps) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [joiningId, setJoiningId] = useState<Id<"conversations"> | null>(null);
  const channels = useQuery(
    api.chat.listChannels,
    open ? { organizationId } : "skip",
  ) as ChatChannel[] | undefined;
  const joinChannel = useMutation(api.chat.joinChannel);

  const filteredChannels = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return channels ?? [];
    return (channels ?? []).filter((channel) =>
      channel.name?.toLowerCase().includes(query),
    );
  }, [channels, search]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) setSearch("");
    onOpenChange(nextOpen);
  };

  const handleChannel = async (channel: ChatChannel) => {
    if (channel.joined) {
      onJoined(channel._id);
      handleOpenChange(false);
      return;
    }

    setJoiningId(channel._id);
    try {
      await joinChannel({ conversationId: channel._id });
      onJoined(channel._id);
      handleOpenChange(false);
    } catch (error: unknown) {
      toast({
        title: "Could not join channel",
        description: errorMessage(error, "Please try again."),
        variant: "destructive",
      });
    } finally {
      setJoiningId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[80vh] max-w-lg flex-col">
        <DialogHeader>
          <DialogTitle>Browse official channels</DialogTitle>
          <DialogDescription>
            Find organization channels and join the conversations relevant to you.
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search channels"
            className="pl-9"
          />
        </div>
        <div className="min-h-40 flex-1 space-y-1 overflow-y-auto py-2">
          {channels === undefined ? (
            <div className="flex h-32 items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : filteredChannels.length === 0 ? (
            <div className="flex h-32 flex-col items-center justify-center text-center">
              <Hash className="mb-2 h-8 w-8 text-muted-foreground/60" />
              <p className="text-sm font-medium">No channels found</p>
              <p className="text-xs text-muted-foreground">
                Official channels created by your organization appear here.
              </p>
            </div>
          ) : (
            filteredChannels.map((channel) => (
              <button
                key={channel._id}
                type="button"
                onClick={() => void handleChannel(channel)}
                disabled={joiningId !== null}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-muted"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-purple/10 text-brand-purple">
                  <Hash className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {channel.name ?? "Channel"}
                  </p>
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Users className="h-3 w-3" />
                    {channel.participantCount} members
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant={channel.joined ? "outline" : "default"}
                  tabIndex={-1}
                >
                  {joiningId === channel._id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : channel.joined ? (
                    "Open"
                  ) : (
                    "Join"
                  )}
                </Button>
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
