"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Badge } from "@/components/ui/badge";
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
} from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { deleteAnnouncement } from "@/app/actions/announcements";
import { getFileUrl } from "@/app/actions/files";
import { useOrganization } from "@/hooks/organization-context";
import { acknowledgeMemo } from "@/app/actions/memos";

interface AnnouncementCardProps {
  announcement: any;
  currentUserId?: string;
  currentEmployeeId?: string;
  isAdminOrHr: boolean;
  canReact?: boolean;
  onDelete?: () => void;
}

const EMOJI_OPTIONS = [
  { emoji: "👍", label: "Thumbs Up", icon: ThumbsUp },
  { emoji: "😮", label: "Surprised" },
  { emoji: "❤️", label: "Heart", icon: Heart },
  { emoji: "😊", label: "Happy", icon: Smile },
  { emoji: "👏", label: "Clap" },
  { emoji: "🎉", label: "Celebrate" },
];

export function AnnouncementCard({
  announcement,
  currentUserId,
  currentEmployeeId,
  isAdminOrHr,
  canReact = true,
  onDelete,
}: AnnouncementCardProps) {
  const { toast } = useToast();
  const { currentOrganizationId } = useOrganization();
  const [previewFile, setPreviewFile] = useState<{
    url: string;
    name: string;
    type: string;
  } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Get author info
  const author = useQuery(
    (api as any).organizations.getUserById,
    announcement.author && currentOrganizationId
      ? {
          userId: announcement.author as Id<"users">,
          organizationId: currentOrganizationId,
        }
      : "skip"
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
    (api as any).announcements.addReaction
  );
  const removeReactionMutation = useMutation(
    (api as any).announcements.removeReaction
  );

  // Check if current employee has acknowledged
  const hasAcknowledged = useMemo(() => {
    if (!currentEmployeeId || !announcement.acknowledgedBy) return false;
    return announcement.acknowledgedBy.some(
      (a: any) => a.employeeId === currentEmployeeId
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

  const handlePreviewFile = async (storageId: string, filename: string) => {
    setPreviewLoading(true);
    try {
      const url = await getFileUrl(storageId);
      // Detect file type from URL or filename
      const extension = filename.split(".").pop()?.toLowerCase() || "";
      let type = "other";
      if (["jpg", "jpeg", "png", "gif", "webp"].includes(extension)) {
        type = "image";
      } else if (extension === "pdf") {
        type = "pdf";
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

  const authorName = author?.name || author?.email || "Unknown";
  // Check if author is admin - if name is "Admin" or we need to check role
  // For now, we'll check if the displayed name would be "Admin" (which happens when role is admin)
  const isAuthorAdmin = authorName === "Admin" || author?.role === "admin";
  const authorInitials = isAuthorAdmin
    ? "A"
    : authorName
        .split(" ")
        .map((n: string) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2);

  return (
    <div className="flex gap-3 p-4 hover:bg-gray-50 transition-colors">
      <Avatar className="h-10 w-10">
        <AvatarFallback className="bg-purple-100 text-purple-700">
          {authorInitials}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between mb-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-gray-900">
              {author?.role === "admin" ? "Admin" : authorName}
            </span>
            <Badge
              variant={
                announcement.priority === "urgent"
                  ? "destructive"
                  : announcement.priority === "important"
                    ? "default"
                    : "secondary"
              }
              className="text-xs"
            >
              {announcement.priority}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">
              {format(new Date(announcement.publishedDate), "h:mm a")}
            </span>
            {isAdminOrHr && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem>
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
        </div>

        <div className="prose max-w-none mb-3 text-sm">{renderContent()}</div>

        {/* File Attachments */}
        {announcement.attachments && announcement.attachments.length > 0 && (
          <div className="space-y-2 mb-3">
            {announcement.attachments.map((storageId: string, idx: number) => (
              <div
                key={idx}
                className="flex items-center gap-2 p-2 border rounded-lg hover:bg-gray-50 cursor-pointer"
                onClick={() => handlePreviewFile(storageId, `File ${idx + 1}`)}
              >
                <FileText className="h-4 w-4 text-gray-500" />
                <span className="flex-1 text-sm truncate">
                  Attachment {idx + 1}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    getFileUrl(storageId).then((url) => {
                      window.open(url, "_blank");
                    });
                  }}
                >
                  <Download className="h-4 w-4" />
                </Button>
              </div>
            ))}
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
      </div>

      {/* File Preview Dialog */}
      {previewFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg p-4 max-w-4xl max-h-[90vh] overflow-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-semibold">{previewFile.name}</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPreviewFile(null)}
              >
                <span className="text-xl">×</span>
              </Button>
            </div>
            {previewLoading ? (
              <div className="flex items-center justify-center h-96">
                <div className="text-gray-500">Loading preview...</div>
              </div>
            ) : previewFile.type === "image" ? (
              <img
                src={previewFile.url}
                alt={previewFile.name}
                className="max-w-full max-h-[70vh] rounded-lg"
              />
            ) : previewFile.type === "pdf" ? (
              <iframe
                src={previewFile.url}
                className="w-full h-[600px] rounded-lg border"
                title={previewFile.name}
              />
            ) : (
              <div className="flex flex-col items-center justify-center p-8">
                <FileText className="h-16 w-16 text-gray-400 mb-4" />
                <p className="text-gray-600 mb-4">
                  Preview not available for this file type
                </p>
                <Button
                  variant="outline"
                  onClick={() => window.open(previewFile.url, "_blank")}
                >
                  <Download className="h-4 w-4 mr-2" />
                  Download File
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

