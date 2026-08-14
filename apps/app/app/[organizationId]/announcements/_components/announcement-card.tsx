"use client";

import Image from "next/image";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { format } from "date-fns";
import {
  CornerDownRight,
  Download,
  Edit,
  FileText,
  Heart,
  MessageCircle,
  MoreHorizontal,
  Send,
  Smile,
  ThumbsUp,
  Trash2,
} from "lucide-react";
import { deleteAnnouncement } from "@/actions/announcements";
import { getAnnouncementAttachmentUrl } from "@/actions/files";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { TiptapViewer } from "@/components/tiptap-viewer";
import { useToast } from "@/components/ui/use-toast";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  applyOptimisticReaction,
  buildCommentThreads,
  type CommentThread,
  getReactionBarEmojis,
  getReactionPickerEmojis,
} from "@/lib/announcements/client-state";

export type Announcement = FunctionReturnType<
  typeof api.announcements.getAnnouncements
>[number];
type CommentPersona = "admin" | "employee";
type AnnouncementComment = FunctionReturnType<
  typeof api.announcements.getComments
>[number];

type AnnouncementCardProps = {
  announcement: Announcement;
  organizationId: Id<"organizations">;
  currentUserId?: Id<"users">;
  canManage: boolean;
  linkedEmployeeName?: string;
  includeScheduled: boolean;
  onRequestEdit: (announcement: Announcement) => void;
};

const REACTIONS = [
  { emoji: "👍", label: "Like", icon: ThumbsUp },
  { emoji: "❤️", label: "Love", icon: Heart },
  { emoji: "😮", label: "Surprised" },
  { emoji: "😊", label: "Happy", icon: Smile },
  { emoji: "👏", label: "Applause" },
  { emoji: "🎉", label: "Celebrate" },
] as const;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong";
}

function Attachment({
  storageId,
  contentType,
  index,
  organizationId,
  announcementId,
  onOpen,
}: {
  storageId: Id<"_storage">;
  contentType?: string;
  index: number;
  organizationId: Id<"organizations">;
  announcementId: Id<"memos">;
  onOpen: (file: { url: string; name: string; type: string }) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getAnnouncementAttachmentUrl(
      organizationId,
      announcementId,
      storageId,
    )
      .then((nextUrl) => {
        if (!cancelled) setUrl(nextUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [announcementId, organizationId, storageId]);

  const isImage = contentType?.startsWith("image/") ?? false;
  const isVideo = contentType?.startsWith("video/") ?? false;
  const name = `Attachment ${index + 1}`;
  if (failed) {
    return (
      <div className="flex aspect-video items-center justify-center rounded-lg border bg-gray-50 text-xs text-gray-500">
        Attachment unavailable
      </div>
    );
  }
  if (!url) {
    return (
      <div className="aspect-video animate-pulse rounded-lg border bg-gray-100" />
    );
  }

  return (
    <button
      type="button"
      onClick={() =>
        onOpen({
          url,
          name,
          type: isImage ? "image" : isVideo ? "video" : "file",
        })
      }
      className="group relative aspect-video overflow-hidden rounded-lg border bg-gray-50 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#695eff]"
    >
      {isImage ? (
        <Image
          src={url}
          alt={name}
          fill
          unoptimized
          sizes="(min-width: 640px) 33vw, 50vw"
          className="object-cover transition-transform group-hover:scale-[1.02]"
        />
      ) : isVideo ? (
        <video src={url} muted preload="metadata" className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full items-center justify-center gap-2 text-sm text-gray-600">
          <FileText className="h-5 w-5" /> {name}
        </span>
      )}
    </button>
  );
}

export function AnnouncementCard({
  announcement,
  organizationId,
  currentUserId,
  canManage,
  linkedEmployeeName,
  includeScheduled,
  onRequestEdit,
}: AnnouncementCardProps) {
  const { toast } = useToast();
  const [commentText, setCommentText] = useState("");
  const [commentAs, setCommentAs] = useState<CommentPersona>("admin");
  const [submittingComment, setSubmittingComment] = useState(false);
  const [replyingTo, setReplyingTo] = useState<{
    commentId: Id<"announcementComments">;
    authorName: string;
  } | null>(null);
  const [replyText, setReplyText] = useState("");
  const [submittingReply, setSubmittingReply] = useState(false);
  const [previewFile, setPreviewFile] = useState<{
    url: string;
    name: string;
    type: string;
  } | null>(null);
  const announcementQueryArgs = useMemo(
    () => ({ organizationId, includeScheduled }),
    [includeScheduled, organizationId],
  );
  const comments = useQuery(api.announcements.getComments, {
    announcementId: announcement._id,
    organizationId,
  });
  const addComment = useMutation(api.announcements.addComment);
  const setReaction = useMutation(
    api.announcements.setReaction,
  ).withOptimisticUpdate((localStore, args) => {
    if (!currentUserId) return;
    const current = localStore.getQuery(
      api.announcements.getAnnouncements,
      announcementQueryArgs,
    );
    if (!current) return;
    localStore.setQuery(
      api.announcements.getAnnouncements,
      announcementQueryArgs,
      applyOptimisticReaction(current, {
        announcementId: args.announcementId,
        userId: currentUserId,
        emoji: args.emoji,
        createdAt: Date.now(),
      }),
    );
  });

  const reactionGroups = useMemo(() => {
    const counts = new Map<string, number>();
    for (const reaction of announcement.reactions) {
      counts.set(reaction.emoji, (counts.get(reaction.emoji) ?? 0) + 1);
    }
    return Array.from(counts, ([emoji, count]) => ({ emoji, count })).sort(
      (left, right) => right.count - left.count,
    );
  }, [announcement.reactions]);
  const reactionBarEmojis = useMemo(
    () => getReactionBarEmojis(announcement.reactions),
    [announcement.reactions],
  );
  const reactionPickerEmojis = getReactionPickerEmojis();
  const commentThreads = useMemo(
    () => buildCommentThreads(comments ?? []),
    [comments],
  );
  const viewerReaction = currentUserId
    ? announcement.reactions.find(
        (reaction) => String(reaction.userId) === String(currentUserId),
      )
    : undefined;
  const canEditAnnouncement =
    canManage &&
    currentUserId !== undefined &&
    String(announcement.author) === String(currentUserId);

  const handleReaction = async (emoji: string) => {
    if (!currentUserId) return;
    try {
      await setReaction({
        announcementId: announcement._id,
        organizationId,
        emoji: viewerReaction?.emoji === emoji ? null : emoji,
      });
    } catch (error: unknown) {
      toast({
        title: "Reaction not saved",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    }
  };

  const handleAddComment = async () => {
    const content = commentText.trim();
    if (!content) return;
    setSubmittingComment(true);
    try {
      await addComment({
        announcementId: announcement._id,
        organizationId,
        content,
        commentAs: canManage ? commentAs : undefined,
      });
      setCommentText("");
    } catch (error: unknown) {
      toast({
        title: "Comment not posted",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setSubmittingComment(false);
    }
  };

  const handleAddReply = async () => {
    const content = replyText.trim();
    if (!content || !replyingTo) return;
    setSubmittingReply(true);
    try {
      await addComment({
        announcementId: announcement._id,
        organizationId,
        content,
        parentCommentId: replyingTo.commentId,
        commentAs: canManage ? commentAs : undefined,
      });
      setReplyText("");
      setReplyingTo(null);
    } catch (error: unknown) {
      toast({
        title: "Reply not posted",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setSubmittingReply(false);
    }
  };

  const renderComment = (
    comment: CommentThread<AnnouncementComment>,
    depth = 0,
  ): ReactNode => (
    <li
      key={comment._id}
      className={
        depth === 0
          ? "rounded-xl border border-gray-200 bg-white p-3 shadow-sm"
          : depth === 1
            ? "ml-4 border-l-2 border-[#695eff]/15 pl-3"
            : "border-l-2 border-[#695eff]/15"
      }
    >
      <div className={depth === 0 ? "" : "rounded-lg bg-white/80 px-3 py-2.5"}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Avatar className="h-7 w-7 shrink-0">
              <AvatarFallback className="bg-[#695eff]/10 text-[10px] font-semibold text-[#5547e8]">
                {comment.authorName
                  .split(/\s+/)
                  .map((part) => part[0])
                  .join("")
                  .toUpperCase()
                  .slice(0, 2) || "M"}
              </AvatarFallback>
            </Avatar>
            <span className="truncate text-sm font-semibold text-gray-900">
              {comment.authorName}
            </span>
          </div>
          <time className="shrink-0 pt-1 text-xs text-gray-400">
            {format(new Date(comment.createdAt), "MMM d · h:mm a")}
          </time>
        </div>
        <p className="mt-2 break-words pl-9 text-sm leading-5 text-gray-700">
          {comment.content}
        </p>
        <button
          type="button"
          onClick={() => {
            setReplyingTo({
              commentId: comment._id,
              authorName: comment.authorName,
            });
            setReplyText("");
          }}
          className="mt-1.5 ml-9 inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-[#5547e8]"
        >
          <CornerDownRight className="h-3.5 w-3.5" /> Reply
        </button>

        {replyingTo?.commentId === comment._id && (
          <div className="mt-2 ml-9 rounded-lg bg-gray-50 p-2">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="truncate text-xs text-gray-500">
                Replying to {replyingTo.authorName}
              </span>
              <button
                type="button"
                onClick={() => {
                  setReplyingTo(null);
                  setReplyText("");
                }}
                className="text-xs font-medium text-gray-500 hover:text-gray-800"
              >
                Cancel
              </button>
            </div>
            <div className="flex items-center gap-2">
              <Input
                value={replyText}
                onChange={(event) => setReplyText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void handleAddReply();
                  }
                }}
                placeholder="Write a reply"
                aria-label={`Reply to ${replyingTo.authorName}`}
                className="h-8 border-gray-200 bg-white"
              />
              <Button
                type="button"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={handleAddReply}
                disabled={!replyText.trim() || submittingReply}
                aria-label="Send reply"
              >
                <Send className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {comment.replies.length > 0 && (
        <ul className="mt-2 space-y-2">
          {comment.replies.map((reply) => renderComment(reply, depth + 1))}
        </ul>
      )}
    </li>
  );

  const handleDelete = async () => {
    if (!window.confirm("Delete this announcement and its comments?")) return;
    try {
      await deleteAnnouncement({
        announcementId: announcement._id,
        organizationId,
      });
      toast({ title: "Announcement deleted" });
    } catch (error: unknown) {
      toast({
        title: "Could not delete announcement",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    }
  };

  const initials =
    announcement.authorPersona === "admin"
      ? "A"
      : announcement.authorName
          .split(/\s+/)
          .map((part) => part[0])
          .join("")
          .toUpperCase()
          .slice(0, 2);
  const audienceLabel =
    announcement.targetAudience === "all"
      ? "Everyone"
      : announcement.targetAudience === "department"
        ? announcement.departments.join(", ")
        : `${announcement.specificEmployees.length} selected employee${
            announcement.specificEmployees.length === 1 ? "" : "s"
          }`;
  const publishedLabel =
    announcement.publicationStatus === "scheduled"
      ? `Scheduled for ${format(new Date(announcement.publishedDate), "MMM d, yyyy · h:mm a")}`
      : format(new Date(announcement.publishedDate), "MMM d, yyyy · h:mm a");

  return (
    <article className="rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="p-5 sm:p-6">
        <header className="flex items-start gap-3">
          <Avatar className="h-10 w-10 shrink-0">
            <AvatarFallback className="bg-[#695eff]/10 text-[#5547e8]">
              {initials || "M"}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-gray-950">
                {announcement.authorName}
              </span>
              {announcement.publicationStatus === "scheduled" && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                  Scheduled
                </span>
              )}
              {announcement.priority !== "normal" && (
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    announcement.priority === "urgent"
                      ? "bg-red-100 text-red-700"
                      : "bg-blue-100 text-blue-700"
                  }`}
                >
                  {announcement.priority === "urgent" ? "Urgent" : "Important"}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-gray-500">{publishedLabel}</p>
          </div>
          {canEditAnnouncement && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Announcement actions">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onRequestEdit(announcement)}>
                  <Edit className="mr-2 h-4 w-4" /> Edit
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleDelete} className="text-red-600">
                  <Trash2 className="mr-2 h-4 w-4" /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </header>

        <div className="mt-4">
          <h2 className="text-xl font-semibold tracking-tight text-gray-950">
            {announcement.title}
          </h2>
          {canManage && (
            <p className="mt-1 text-xs text-gray-500">Audience: {audienceLabel}</p>
          )}
          <TiptapViewer content={announcement.content} className="mt-3 text-sm" />
        </div>

        {announcement.attachments.length > 0 && (
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {announcement.attachments.map((storageId, index) => (
              <Attachment
                key={storageId}
                storageId={storageId}
                contentType={announcement.attachmentContentTypes[index]}
                index={index}
                organizationId={organizationId}
                announcementId={announcement._id}
                onOpen={setPreviewFile}
              />
            ))}
          </div>
        )}

        {announcement.publicationStatus === "published" && (
          <div className="mt-4 flex flex-wrap items-center gap-1 border-t border-gray-100 pt-3">
            {reactionBarEmojis.map((emoji) => {
              const reaction = REACTIONS.find((option) => option.emoji === emoji);
              if (!reaction) return null;
              const count =
                reactionGroups.find((group) => group.emoji === reaction.emoji)
                  ?.count ?? 0;
              const active = viewerReaction?.emoji === reaction.emoji;
              const Icon = "icon" in reaction ? reaction.icon : undefined;
              return (
                <Button
                  key={reaction.emoji}
                  type="button"
                  variant={active ? "default" : "ghost"}
                  size="sm"
                  aria-label={reaction.label}
                  onClick={() => handleReaction(reaction.emoji)}
                  className="h-8"
                >
                  {Icon ? <Icon className="h-4 w-4" /> : reaction.emoji}
                  {count > 0 && <span>{count}</span>}
                </Button>
              );
            })}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8" aria-label="More reactions">
                  <Smile className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {reactionPickerEmojis.map((emoji) => {
                  const reaction = REACTIONS.find(
                    (option) => option.emoji === emoji,
                  );
                  if (!reaction) return null;
                  return (
                    <DropdownMenuItem
                      key={reaction.emoji}
                      onClick={() => handleReaction(reaction.emoji)}
                    >
                      <span className="mr-2">{reaction.emoji}</span>
                      {reaction.label}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
            {reactionGroups.length > 0 && (
              <span className="ml-1 text-xs text-gray-500">
                {reactionGroups.reduce((sum, group) => sum + group.count, 0)}{" "}
                reactions
              </span>
            )}
          </div>
        )}
      </div>

      {announcement.publicationStatus === "published" && (
        <section className="border-t border-gray-100 bg-gray-50/60 px-5 py-4 sm:px-6">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-gray-700">
            <MessageCircle className="h-4 w-4" />
            Comments{comments?.length ? ` (${comments.length})` : ""}
          </div>
          {commentThreads.length > 0 && (
            <ul className="mb-4 space-y-3">
              {commentThreads.map((comment) => renderComment(comment))}
            </ul>
          )}

          {canManage && linkedEmployeeName && (
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="text-xs text-gray-500">Comment as</span>
              <Button
                type="button"
                size="sm"
                variant={commentAs === "admin" ? "default" : "outline"}
                onClick={() => setCommentAs("admin")}
              >
                Admin
              </Button>
              <Button
                type="button"
                size="sm"
                variant={commentAs === "employee" ? "default" : "outline"}
                onClick={() => setCommentAs("employee")}
              >
                {linkedEmployeeName}
              </Button>
            </div>
          )}

          <div className="flex items-center gap-2">
            <Input
              value={commentText}
              onChange={(event) => setCommentText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void handleAddComment();
                }
              }}
              placeholder="Write a comment"
              aria-label="Comment"
              className="h-9 border-gray-200 bg-white shadow-sm"
            />
            <Button
              type="button"
              size="icon"
              className="h-9 w-9 shrink-0"
              onClick={handleAddComment}
              disabled={!commentText.trim() || submittingComment}
              aria-label="Send comment"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </section>
      )}

      {previewFile && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={previewFile.name}
          onClick={() => setPreviewFile(null)}
        >
          <div
            className="relative flex max-h-full max-w-full items-center justify-center"
            onClick={(event) => event.stopPropagation()}
          >
            <Button
              variant="outline"
              className="absolute -top-12 right-0"
              onClick={() => setPreviewFile(null)}
            >
              Close
            </Button>
            {previewFile.type === "image" ? (
              <div className="relative h-[85vh] w-[90vw]">
                <Image
                  src={previewFile.url}
                  alt={previewFile.name}
                  fill
                  unoptimized
                  sizes="90vw"
                  className="rounded-lg object-contain"
                />
              </div>
            ) : previewFile.type === "video" ? (
              <video
                src={previewFile.url}
                controls
                autoPlay
                className="max-h-[85vh] max-w-full rounded-lg"
              />
            ) : (
              <Button asChild>
                <a href={previewFile.url} target="_blank" rel="noreferrer">
                  <Download className="mr-2 h-4 w-4" /> Open attachment
                </a>
              </Button>
            )}
          </div>
        </div>
      )}
    </article>
  );
}
