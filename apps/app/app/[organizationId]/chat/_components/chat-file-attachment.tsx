"use client";

import { useEffect, useState, useRef } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { Download, FileText } from "lucide-react";
import { chatCache } from "@/services/chat-cache-service";

function isPreviewableMedia(
  contentType: string | null,
): "image" | "video" | false {
  if (!contentType) return false;
  if (contentType.startsWith("image/")) return "image";
  if (contentType.startsWith("video/")) return "video";
  return false;
}

type CachedFileAttachmentProps = {
  storageId: string;
  isOwnMessage: boolean;
  organizationId: string;
};

/**
 * Loads chat file URLs from Convex when online; decrypts from IndexedDB when cached
 * so images/videos still render offline without refetching.
 */
export function CachedFileAttachment({
  storageId,
  isOwnMessage,
  organizationId,
}: CachedFileAttachmentProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [contentType, setContentType] = useState<string | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  const fileData = useQuery(
    (api as any).files.getFileUrlAndType,
    storageId ? { storageId: storageId as Id<"_storage"> } : "skip",
  );

  // Revoke object URLs on unmount or when replacing
  useEffect(() => {
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, []);

  const setBlobFromBuffer = (data: ArrayBuffer, type: string) => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    const blob = new Blob([data], { type: type || "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    blobUrlRef.current = url;
    setBlobUrl(url);
    setContentType(type);
  };

  // 1) Try encrypted IndexedDB first (instant when revisiting / offline)
  useEffect(() => {
    if (!organizationId || !storageId) return;
    let cancelled = false;
    (async () => {
      try {
        await chatCache.initialize(organizationId);
        const cached = await chatCache.getCachedAttachment(storageId);
        if (cancelled || !cached) return;
        setBlobFromBuffer(cached.data, cached.contentType);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [organizationId, storageId]);

  // 2) When we have a network URL, fetch once and refresh cache + display if needed
  useEffect(() => {
    if (!fileData?.url || !organizationId || !storageId) return;
    let cancelled = false;
    const url = fileData.url;
    const netType = fileData.contentType ?? "application/octet-stream";

    (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok || cancelled) return;
        const buf = await res.arrayBuffer();
        if (cancelled) return;
        await chatCache.initialize(organizationId);
        await chatCache.cacheAttachment(storageId, buf, netType);
        if (cancelled) return;
        setBlobFromBuffer(buf, netType);
      } catch {
        // Offline or CORS: keep existing blobUrl from cache if any
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fileData?.url, fileData?.contentType, organizationId, storageId]);

  const previewType = isPreviewableMedia(contentType);
  const downloadClass = isOwnMessage
    ? "bg-purple-500/20 text-white hover:bg-purple-500/30"
    : "bg-gray-100 text-gray-700 hover:bg-gray-200";

  if (blobUrl && previewType === "image") {
    return (
      <div className="space-y-1">
        <div className="rounded-lg overflow-hidden bg-white max-w-[280px] max-h-[320px]">
          <a
            href={blobUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block"
          >
            <img
              src={blobUrl}
              alt="Attachment"
              className="w-full h-auto object-contain max-h-[320px]"
            />
          </a>
        </div>
        <a
          href={blobUrl}
          download
          target="_blank"
          rel="noopener noreferrer"
          className={`inline-flex items-center gap-1.5 text-xs p-1.5 rounded transition-all ${downloadClass}`}
        >
          <Download className="h-3 w-3 shrink-0" />
          <span>Download</span>
        </a>
      </div>
    );
  }

  if (blobUrl && previewType === "video") {
    return (
      <div className="space-y-1">
        <div className="rounded-lg overflow-hidden bg-white max-w-[280px] max-h-[320px]">
          <video src={blobUrl} controls className="w-full h-auto max-h-[320px]" />
        </div>
        <a
          href={blobUrl}
          download
          target="_blank"
          rel="noopener noreferrer"
          className={`inline-flex items-center gap-1.5 text-xs p-1.5 rounded transition-all ${downloadClass}`}
        >
          <Download className="h-3 w-3 shrink-0" />
          <span>Download</span>
        </a>
      </div>
    );
  }

  if (blobUrl) {
    return (
      <a
        href={blobUrl}
        download
        target="_blank"
        rel="noopener noreferrer"
        className={`inline-flex items-center gap-2 text-xs p-2 rounded transition-all ${downloadClass}`}
      >
        <FileText className="h-4 w-4 shrink-0" />
        <span>Download file</span>
      </a>
    );
  }

  if (
    fileData === undefined &&
    typeof navigator !== "undefined" &&
    !navigator.onLine
  ) {
    return (
      <div className="text-xs text-gray-500">
        Connect to load this file (not cached on this device yet)
      </div>
    );
  }

  if (fileData === undefined) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <div className="animate-spin h-3 w-3 border-2 border-gray-400 border-t-transparent rounded-full" />
        <span>Loading file…</span>
      </div>
    );
  }

  if (!fileData?.url) {
    return (
      <div className="text-xs text-gray-500">
        File not available (connect to sync)
      </div>
    );
  }

  // fileData resolved but blob not yet (fetch in flight)
  return (
    <div className="flex items-center gap-2 text-xs">
      <div className="animate-spin h-3 w-3 border-2 border-gray-400 border-t-transparent rounded-full" />
      <span>Preparing preview…</span>
    </div>
  );
}
