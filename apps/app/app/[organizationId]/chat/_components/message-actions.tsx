"use client";

import { Forward, MoreHorizontal, Pencil, Reply, SmilePlus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export const CHAT_REACTIONS = ["👍", "❤️", "🎉", "😂", "😮", "😢"] as const;

type MessageActionsProps = {
  canEdit: boolean;
  canDelete: boolean;
  canForward: boolean;
  onReply: () => void;
  onReact: (emoji: (typeof CHAT_REACTIONS)[number]) => void;
  onEdit: () => void;
  onDelete: () => void;
  onForward: () => void;
};

export function MessageActions({
  canEdit,
  canDelete,
  canForward,
  onReply,
  onReact,
  onEdit,
  onDelete,
  onForward,
}: MessageActionsProps) {
  return (
    <div className="flex items-center rounded-lg border bg-background p-0.5 shadow-sm">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={onReply}
        aria-label="Reply"
      >
        <Reply className="h-3.5 w-3.5" />
      </Button>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label="React"
          >
            <SmilePlus className="h-3.5 w-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-1.5" side="top">
          <div className="flex items-center gap-0.5">
            {CHAT_REACTIONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => onReact(emoji)}
                className="flex h-8 w-8 items-center justify-center rounded-md text-lg hover:bg-muted"
                aria-label={`React with ${emoji}`}
              >
                {emoji}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label="More message actions"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canEdit && (
            <DropdownMenuItem onClick={onEdit}>
              <Pencil className="mr-2 h-4 w-4" />
              Edit message
            </DropdownMenuItem>
          )}
          {canForward && (
            <DropdownMenuItem onClick={onForward}>
              <Forward className="mr-2 h-4 w-4" />
              Forward message
            </DropdownMenuItem>
          )}
          {canDelete && (
            <DropdownMenuItem
              onClick={onDelete}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Remove message
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
