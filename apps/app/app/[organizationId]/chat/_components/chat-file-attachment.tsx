"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { Download, ExternalLink, FileText } from "lucide-react";
import Image from "next/image";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type AttachmentPreviewMode = "image" | "video" | "pdf" | "file";

export function getAttachmentPreviewMode(
  contentType: string | null,
): AttachmentPreviewMode {
  if (!contentType) return "file";
  if (contentType.startsWith("image/")) return "image";
  if (contentType.startsWith("video/")) return "video";
  if (contentType === "application/pdf") return "pdf";
  return "file";
}

type ChatFileAttachmentProps = {
  conversationId: Id<"conversations">;
  messageId: Id<"messages">;
  storageId: Id<"_storage">;
  isOwnMessage: boolean;
};

type AttachmentPreviewDialogProps = {
  url: string;
  mode: AttachmentPreviewMode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function AttachmentPreviewDialog({
  url,
  mode,
  open,
  onOpenChange,
}: AttachmentPreviewDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-[92vw] max-w-5xl flex-col">
        <DialogHeader>
          <DialogTitle>Attachment preview</DialogTitle>
        </DialogHeader>
        <div className="flex min-h-72 flex-1 items-center justify-center overflow-auto rounded-xl bg-muted/40">
          {mode === "image" ? (
            <Image
              src={url}
              alt="Attachment preview"
              width={1200}
              height={800}
              unoptimized
              className="max-h-[72vh] max-w-full object-contain"
            />
          ) : mode === "video" ? (
            <video src={url} controls className="max-h-[72vh] max-w-full" />
          ) : mode === "pdf" ? (
            <iframe
              src={url}
              title="Attachment preview"
              className="h-[72vh] w-full rounded-xl border bg-white"
            />
          ) : (
            <div className="flex min-h-80 flex-col items-center justify-center p-8 text-center">
              <FileText className="mb-3 h-12 w-12 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Preview is not available for this file type.
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button asChild variant="outline">
            <a href={url} target="_blank" rel="noreferrer">
              <ExternalLink className="h-4 w-4" />
              Open in New Tab
            </a>
          </Button>
          <Button asChild>
            <a href={url} download>
              <Download className="h-4 w-4" />
              Download
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ChatFileAttachment({
  conversationId,
  messageId,
  storageId,
  isOwnMessage,
}: ChatFileAttachmentProps) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const fileData = useQuery(api.chat.getChatAttachmentUrl, {
    conversationId,
    messageId,
    storageId,
  });

  if (fileData === undefined) {
    return (
      <div className="flex items-center gap-2 text-xs opacity-75">
        <div className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
        <span>Loading attachment…</span>
      </div>
    );
  }

  if (!fileData.url) {
    return <p className="text-xs opacity-75">Attachment is unavailable.</p>;
  }

  const mode = getAttachmentPreviewMode(fileData.contentType);
  const actionClass = isOwnMessage
    ? "bg-white/15 text-white hover:bg-white/25"
    : "bg-muted text-foreground hover:bg-muted/80";

  return (
    <div className="space-y-2">
      {mode === "image" ? (
        <button
          type="button"
          onClick={() => setPreviewOpen(true)}
          className="block max-h-80 max-w-72 overflow-hidden rounded-xl bg-background/90"
          aria-label="Preview attachment"
        >
          <Image
            src={fileData.url}
            alt="Attachment"
            width={288}
            height={320}
            unoptimized
            className="max-h-80 w-full object-contain"
          />
        </button>
      ) : mode === "video" ? (
        <video
          src={fileData.url}
          controls
          className="max-h-80 max-w-72 rounded-xl bg-black"
        />
      ) : (
        <button
          type="button"
          onClick={() => setPreviewOpen(true)}
          className={`inline-flex items-center gap-2 rounded-lg p-2 text-xs transition-colors ${actionClass}`}
        >
          <FileText className="h-4 w-4" />
          Preview file
        </button>
      )}
      <a
        href={fileData.url}
        download
        className={`inline-flex items-center gap-1.5 rounded-lg p-2 text-xs transition-colors ${actionClass}`}
      >
        <Download className="h-3.5 w-3.5" />
        Download
      </a>
      <AttachmentPreviewDialog
        url={fileData.url}
        mode={mode}
        open={previewOpen}
        onOpenChange={setPreviewOpen}
      />
    </div>
  );
}
