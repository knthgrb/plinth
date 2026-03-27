"use client";

import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { format } from "date-fns";
import { Id } from "@/convex/_generated/dataModel";
import {
  MoreVertical,
  Trash2,
  Edit,
  ThumbsUp,
  Smile,
  Heart,
  Download,
  FileText,
  Bell,
  Check,
  MessageCircle,
  Send,
} from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { deleteAnnouncement } from "@/actions/announcements";
import { getAnnouncementAttachmentUrl } from "@/actions/files";
import { useOrganization } from "@/hooks/organization-context";
import { useEmployeeView } from "@/hooks/employee-view-context";
import { acknowledgeMemo } from "@/actions/memos";

interface AnnouncementCardProps {
  announcement: any;
  currentUserId?: string;
  currentEmployeeId?: string;
  canReact?: boolean;
  onDelete?: () => void;
  onRequestEdit?: (announcement: any) => void;
}

const EMOJI_OPTIONS = [
  { emoji: "👍", label: "Thumbs Up", icon: ThumbsUp },
  { emoji: "😮", label: "Surprised" },
  { emoji: "❤️", label: "Heart", icon: Heart },
  { emoji: "😊", label: "Happy", icon: Smile },
  { emoji: "👏", label: "Clap" },
  { emoji: "🎉", label: "Celebrate" },
];

// When type is "other", try showing as image first (e.g. missing contentType); fallback to open in new tab
function PreviewOtherFallback({
  previewFile,
}: {
  previewFile: { url: string; name: string; type: string };
}) {
  const [imageFailed, setImageFailed] = useState(false);

  if (imageFailed) {
    return (
      <div className="flex flex-col items-center justify-center p-8 bg-white rounded-lg">
        <FileText className="h-16 w-16 text-gray-400 mb-4" />
        <p className="text-gray-600 mb-4">Preview not available</p>
        <Button
          variant="outline"
          onClick={() => window.open(previewFile.url, "_blank")}
        >
          <Download className="h-4 w-4 mr-2" />
          Open in new tab
        </Button>
      </div>
    );
  }

  return (
    <img
      src={previewFile.url}
      alt={previewFile.name}
      className="max-w-full max-h-[90vh] object-contain rounded-lg"
      onError={() => setImageFailed(true)}
    />
  );
}

function AttachmentPreview({
  storageId,
  contentType,
  index,
  organizationId,
  announcementId,
  onPreview,
}: {
  storageId: string;
  contentType?: string;
  index: number;
  organizationId: string;
  announcementId: string;
  onPreview: (storageId: string, name: string, contentType?: string) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const isVideo = contentType?.startsWith("video/");
  const isImage = !contentType || contentType.startsWith("image/");

  useEffect(() => {
    let cancelled = false;
    getAnnouncementAttachmentUrl(organizationId, announcementId, storageId)
      .then((u) => {
        if (!cancelled) setUrl(u);
      })
      .catch(() => {
        if (!cancelled) setUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [storageId, organizationId, announcementId]);

  if (!url) {
    return (
      <div className="rounded-lg border border-gray-100 bg-gray-50 aspect-video max-h-48 flex items-center justify-center">
        <span className="text-xs text-gray-400">Loading…</span>
      </div>
    );
  }

  const name = `Attachment ${index + 1}`;
  return (
    <div
      className="rounded-lg border border-gray-100 overflow-hidden bg-gray-50 cursor-pointer hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-purple-500/30"
      onClick={() => onPreview(storageId, name, contentType)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPreview(storageId, name, contentType);
        }
      }}
    >
      {isImage && (
        <img
          src={url}
          alt={name}
          className="w-full object-contain max-h-48 aspect-video"
        />
      )}
      {isVideo && (
        <video
          src={url}
          className="w-full object-contain max-h-48 aspect-video"
          muted
          preload="metadata"
          playsInline
        />
      )}
      {!isImage && !isVideo && (
        <div className="flex items-center gap-2 p-3 aspect-video max-h-48">
          <FileText className="h-8 w-8 text-gray-400" />
          <span className="text-sm text-gray-600">{name}</span>
        </div>
      )}
    </div>
  );
}

export function AnnouncementCard({
  announcement,
  currentUserId,
  currentEmployeeId,
  canReact = true,
  onDelete,
  onRequestEdit,
}: AnnouncementCardProps) {
  const { toast } = useToast();
  const { currentOrganizationId, effectiveOrganizationId } = useOrganization();
  const { isEmployeeExperienceUI } = useEmployeeView();
  const [commentText, setCommentText] = useState("");
  const [commentAs, setCommentAs] = useState<"user" | "admin">("admin");
  const [submittingComment, setSubmittingComment] = useState(false);
  const [previewFile, setPreviewFile] = useState<{
    url: string;
    name: string;
    type: string;
  } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const viewer = useQuery(
    (api as any).organizations.getCurrentUser,
    effectiveOrganizationId
      ? { organizationId: effectiveOrganizationId as Id<"organizations"> }
      : "skip",
  );

  /**
   * Admin / HR / owner only — matches who can create announcements.
   * Hidden while "employee experience" UI is on (view as employee).
   */
  const isStaff =
    viewer?.role === "admin" ||
    viewer?.role === "hr" ||
    viewer?.role === "owner";

  const isStaffElevated = isStaff && !isEmployeeExperienceUI;

  const isAnnouncementAuthor = Boolean(
    currentUserId &&
      String(announcement.author) === String(currentUserId),
  );

  const showAuthorActionsMenu =
    isStaffElevated && isAnnouncementAuthor;

  // Get author info
  const author = useQuery(
    (api as any).organizations.getUserById,
    announcement.author && currentOrganizationId
      ? {
          userId: announcement.author as Id<"users">,
          organizationId: currentOrganizationId,
        }
      : "skip",
  );

  // Current user info (for "comment as" label when admin/owner/hr)
  const currentUser = useQuery(
    (api as any).organizations.getUserById,
    currentUserId && currentOrganizationId
      ? {
          userId: currentUserId as Id<"users">,
          organizationId: currentOrganizationId,
        }
      : "skip",
  );

  // Get reactions grouped by emoji
  const reactionGroups = useMemo(() => {
    if (!announcement.reactions || announcement.reactions.length === 0) {
      return [];
    }

    const groups: { [key: string]: number } = {};
    announcement.reactions.forEach((reaction: any) => {
      groups[reaction.emoji] = (groups[reaction.emoji] || 0) + 1;
    });

    return Object.entries(groups)
      .map(([emoji, count]) => ({ emoji, count }))
      .sort((a, b) => b.count - a.count);
  }, [announcement.reactions]);

  // Check if current user has reacted
  const userReaction = useMemo(() => {
    if (!currentUserId || !announcement.reactions) return null;
    return announcement.reactions.find((r: any) => r.userId === currentUserId);
  }, [announcement.reactions, currentUserId]);

  const addReactionMutation = useMutation(
    (api as any).announcements.addReaction,
  );
  const removeReactionMutation = useMutation(
    (api as any).announcements.removeReaction,
  );

  const comments = useQuery(
    (api as any).announcements.getComments,
    currentOrganizationId && announcement._id
      ? {
          announcementId: announcement._id,
          organizationId: currentOrganizationId,
        }
      : "skip",
  );
  const addCommentMutation = useMutation(
    (api as any).announcements.addComment,
  );

  // Check if current employee has acknowledged
  const hasAcknowledged = useMemo(() => {
    if (!currentEmployeeId || !announcement.acknowledgedBy) return false;
    return announcement.acknowledgedBy.some(
      (a: any) => a.employeeId === currentEmployeeId,
    );
  }, [announcement.acknowledgedBy, currentEmployeeId]);

  const handleAcknowledge = async () => {
    if (!currentEmployeeId || !announcement._id) return;

    try {
      await acknowledgeMemo(announcement._id, currentEmployeeId);
      toast({
        title: "Success",
        description: "Announcement acknowledged",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to acknowledge announcement",
        variant: "destructive",
      });
    }
  };

  const handleReaction = async (emoji: string) => {
    if (!currentOrganizationId) return;

    try {
      if (userReaction?.emoji === emoji) {
        // Remove reaction
        await removeReactionMutation({
          announcementId: announcement._id,
          organizationId: currentOrganizationId,
        });
      } else {
        // Add or change reaction
        await addReactionMutation({
          announcementId: announcement._id,
          organizationId: currentOrganizationId,
          emoji,
        });
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update reaction",
        variant: "destructive",
      });
    }
  };

  const handleAddComment = async () => {
    const trimmed = commentText.trim();
    if (!trimmed || !currentOrganizationId) return;
    setSubmittingComment(true);
    try {
      await addCommentMutation({
        announcementId: announcement._id,
        organizationId: currentOrganizationId,
        content: trimmed,
        commentAs: isStaffElevated ? commentAs : undefined,
      });
      setCommentText("");
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to post comment",
        variant: "destructive",
      });
    } finally {
      setSubmittingComment(false);
    }
  };

  const handleDelete = async () => {
    if (!currentOrganizationId) return;
    if (!confirm("Are you sure you want to delete this announcement?")) return;

    try {
      await deleteAnnouncement({
        announcementId: announcement._id,
        organizationId: currentOrganizationId,
      });
      toast({
        title: "Success",
        description: "Announcement deleted successfully",
      });
      onDelete?.();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to delete announcement",
        variant: "destructive",
      });
    }
  };

  const handlePreviewFile = async (
    storageId: string,
    filename: string,
    contentType?: string,
  ) => {
    if (!currentOrganizationId) return;
    setPreviewLoading(true);
    try {
      const url = await getAnnouncementAttachmentUrl(
        currentOrganizationId,
        announcement._id,
        storageId,
      );
      let type = "other";
      if (contentType) {
        if (contentType.startsWith("image/")) type = "image";
        else if (contentType.startsWith("video/")) type = "video";
      } else {
        const extension = filename.split(".").pop()?.toLowerCase() || "";
        if (["jpg", "jpeg", "png", "gif", "webp"].includes(extension)) type = "image";
        else if (["mp4", "webm", "mov"].includes(extension)) type = "video";
      }
      setPreviewFile({ url, name: filename, type });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to load file preview",
        variant: "destructive",
      });
    } finally {
      setPreviewLoading(false);
    }
  };

  const renderContent = () => {
    try {
      const content = JSON.parse(announcement.content);
      const renderNode = (node: any): string => {
        if (node.type === "paragraph") {
          const text = node.content
            ? node.content.map((c: any) => renderNode(c)).join("")
            : "";
          return `<p>${text}</p>`;
        }
        if (node.type === "heading") {
          const level = node.attrs?.level || 1;
          const text = node.content
            ? node.content.map((c: any) => renderNode(c)).join("")
            : "";
          return `<h${level}>${text}</h${level}>`;
        }
        if (node.type === "bulletList") {
          const items = node.content
            ? node.content.map((c: any) => renderNode(c)).join("")
            : "";
          return `<ul>${items}</ul>`;
        }
        if (node.type === "orderedList") {
          const items = node.content
            ? node.content.map((c: any) => renderNode(c)).join("")
            : "";
          return `<ol>${items}</ol>`;
        }
        if (node.type === "listItem") {
          const text = node.content
            ? node.content.map((c: any) => renderNode(c)).join("")
            : "";
          return `<li>${text}</li>`;
        }
        if (node.type === "text") {
          let text = node.text || "";
          if (node.marks) {
            node.marks.forEach((mark: any) => {
              if (mark.type === "bold") {
                text = `<strong>${text}</strong>`;
              } else if (mark.type === "italic") {
                text = `<em>${text}</em>`;
              } else if (mark.type === "link") {
                text = `<a href="${mark.attrs?.href || "#"}" target="_blank" class="text-purple-600 underline">${text}</a>`;
              }
            });
          }
          return text;
        }
        if (node.content) {
          return node.content.map((c: any) => renderNode(c)).join("");
        }
        return "";
      };
      const html = content.content
        ? content.content.map((node: any) => renderNode(node)).join("")
        : "<p>No content</p>";
      return (
        <div
          dangerouslySetInnerHTML={{
            __html: html || "<p>No content</p>",
          }}
        />
      );
    } catch (error) {
      console.error("Error rendering content:", error);
      return <p className="text-gray-500">Error rendering content</p>;
    }
  };

  const authorNameFromUser = author?.name || author?.email || "Unknown";
  const displayAuthorName =
    announcement.authorDisplayName === "Admin"
      ? "Admin"
      : authorNameFromUser;
  const isShownAsAdmin = announcement.authorDisplayName === "Admin";
  const authorInitials = isShownAsAdmin
    ? "A"
    : displayAuthorName
        .split(" ")
        .map((n: string) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2);

  return (
    <div className="flex gap-3 p-4 hover:bg-gray-50/50 transition-colors rounded-xl">
      <Avatar className="h-10 w-10">
        <AvatarFallback className="bg-purple-100 text-purple-700">
          {authorInitials}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between mb-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-gray-900">
              {displayAuthorName}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">
              {format(new Date(announcement.publishedDate), "h:mm a")}
            </span>
            {showAuthorActionsMenu && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() => onRequestEdit?.(announcement)}
                  >
                    <Edit className="h-4 w-4 mr-2" />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={handleDelete}
                    className="text-red-600"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>

        <div className="mb-2">
          <h3 className="font-semibold text-lg mb-2">{announcement.title}</h3>
          {isStaffElevated && (
            <p className="text-xs text-gray-500 mt-1">
              Target:{" "}
              {announcement.targetAudience === "all"
                ? "All employees"
                : announcement.targetAudience === "department"
                  ? announcement.departments?.length
                    ? announcement.departments.join(", ")
                    : "—"
                  : announcement.specificEmployees?.length
                    ? `${announcement.specificEmployees.length} employee(s)`
                    : "—"}
            </p>
          )}
        </div>

        <div className="prose max-w-none mb-3 text-sm">{renderContent()}</div>

        {/* File Attachments (images & videos – preview + full-screen on click) */}
        {announcement.attachments && announcement.attachments.length > 0 && (
          <div className="space-y-2 mb-3">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {currentOrganizationId &&
                announcement.attachments.map((storageId: string, idx: number) => (
                  <AttachmentPreview
                    key={idx}
                    storageId={storageId}
                    contentType={announcement.attachmentContentTypes?.[idx]}
                    index={idx}
                    organizationId={currentOrganizationId}
                    announcementId={announcement._id}
                    onPreview={handlePreviewFile}
                  />
                ))}
            </div>
          </div>
        )}

        {/* Acknowledgement Required */}
        {announcement.acknowledgementRequired && (
          <div className="mb-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bell className="h-4 w-4 text-yellow-700" />
                <div>
                  <p className="text-sm font-medium text-yellow-900">
                    Acknowledgement Required
                  </p>
                  <p className="text-xs text-yellow-700">
                    {announcement.acknowledgedBy?.length || 0} of{" "}
                    {announcement.targetAudience === "all"
                      ? "all employees"
                      : announcement.targetAudience === "department"
                        ? `${announcement.departments?.length || 0} department(s)`
                        : `${announcement.specificEmployees?.length || 0} employee(s)`}{" "}
                    acknowledged
                  </p>
                </div>
              </div>
              {currentEmployeeId && !hasAcknowledged && (
                <Button
                  size="sm"
                  onClick={handleAcknowledge}
                  className="bg-yellow-600 hover:bg-yellow-700"
                >
                  <Check className="h-4 w-4 mr-1" />
                  Acknowledge
                </Button>
              )}
              {hasAcknowledged && (
                <div className="flex items-center gap-1 text-sm text-green-700">
                  <Check className="h-4 w-4" />
                  <span>Acknowledged</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Reactions */}
        {canReact && (
          <div className="flex items-center gap-2 mt-3">
            <div className="flex items-center gap-1">
              {EMOJI_OPTIONS.slice(0, 3).map((option) => {
                const Icon = option.icon;
                const count =
                  reactionGroups.find((g) => g.emoji === option.emoji)?.count ||
                  0;
                const isActive = userReaction?.emoji === option.emoji;

                return (
                  <Button
                    key={option.emoji}
                    variant={isActive ? "default" : "ghost"}
                    size="sm"
                    className="h-8 px-2"
                    onClick={() => handleReaction(option.emoji)}
                  >
                    {Icon ? (
                      <Icon className="h-4 w-4" />
                    ) : (
                      <span>{option.emoji}</span>
                    )}
                    {count > 0 && <span className="ml-1 text-xs">{count}</span>}
                  </Button>
                );
              })}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 px-2">
                  <Smile className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {EMOJI_OPTIONS.map((option) => (
                  <DropdownMenuItem
                    key={option.emoji}
                    onClick={() => handleReaction(option.emoji)}
                  >
                    <span className="mr-2">{option.emoji}</span>
                    {option.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            {reactionGroups.length > 0 && (
              <div className="flex items-center gap-1 ml-2">
                {reactionGroups.map((group) => (
                  <span
                    key={group.emoji}
                    className="text-xs bg-gray-100 px-2 py-1 rounded-full"
                  >
                    {group.emoji} {group.count}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Comments (only org members see and can comment) */}
        <div className="mt-4 pt-3 border-t border-gray-100">
          <div className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
            <MessageCircle className="h-4 w-4" />
            <span>Comments {comments && comments.length > 0 ? `(${comments.length})` : ""}</span>
          </div>
          {comments && comments.length > 0 && (
            <ul className="space-y-2 mb-3">
              {comments.map((c: any) => (
                <li
                  key={c._id}
                  className="text-sm bg-gray-50 rounded-lg p-2"
                >
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <span className="font-medium text-gray-900">
                      {c.authorName}
                    </span>
                    <span className="text-xs text-gray-500">
                      {format(new Date(c.createdAt), "MMM d, h:mm a")}
                    </span>
                  </div>
                  <p className="text-gray-700 break-words">{c.content}</p>
                </li>
              ))}
            </ul>
          )}
          {isStaffElevated && (
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs text-gray-500">Comment as:</span>
              <button
                type="button"
                onClick={() => setCommentAs("admin")}
                className={`text-xs px-2 py-1 rounded-md border ${
                  commentAs === "admin"
                    ? "bg-purple-100 border-purple-300 text-purple-800 font-medium"
                    : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
                }`}
              >
                Admin
              </button>
              <button
                type="button"
                onClick={() => setCommentAs("user")}
                className={`text-xs px-2 py-1 rounded-md border ${
                  commentAs === "user"
                    ? "bg-purple-100 border-purple-300 text-purple-800 font-medium"
                    : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
                }`}
              >
                {currentUser?.name || currentUser?.email || "You"}
              </button>
            </div>
          )}
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Write a comment..."
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleAddComment();
                }
              }}
              className="flex-1 rounded-lg border border-gray-200 bg-gray-50/50 px-3 py-2 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-300"
            />
            <Button
              size="sm"
              onClick={handleAddComment}
              disabled={!commentText.trim() || submittingComment}
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Full-screen attachment preview */}
      {previewFile && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setPreviewFile(null)}
        >
          <div
            className="relative max-w-full max-h-full flex items-center justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            <Button
              variant="ghost"
              size="icon"
              className="absolute -top-12 right-0 text-white hover:bg-white/20"
              onClick={() => setPreviewFile(null)}
              aria-label="Close"
            >
              <span className="text-2xl">×</span>
            </Button>
            {previewLoading ? (
              <div className="flex items-center justify-center h-96 text-white">
                Loading…
              </div>
            ) : previewFile.type === "image" ? (
              <img
                src={previewFile.url}
                alt={previewFile.name}
                className="max-w-full max-h-[90vh] object-contain rounded-lg"
              />
            ) : previewFile.type === "video" ? (
              <video
                src={previewFile.url}
                controls
                autoPlay
                className="max-w-full max-h-[90vh] rounded-lg"
              />
            ) : (
              <PreviewOtherFallback previewFile={previewFile} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
