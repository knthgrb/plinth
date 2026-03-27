"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { MainLayout } from "@/components/layout/main-layout";
import { Button } from "@/components/ui/button";
import { useOrganization } from "@/hooks/organization-context";
import { Bell, Plus, ChevronDown } from "lucide-react";
import { useState, useEffect, useRef, useMemo } from "react";
import dynamic from "next/dynamic";
import { AnnouncementCard } from "./_components/announcement-card";
import type { AnnouncementEditSnapshot } from "./_components/create-announcement-modal";

const CreateAnnouncementModal = dynamic(
  () => import("./_components/create-announcement-modal").then((m) => m.CreateAnnouncementModal),
  { ssr: false },
);

const INITIAL_PAGE_SIZE = 10;
const PAGE_SIZE = 10;

export default function AnnouncementsPage() {
  const { effectiveOrganizationId, currentOrganization } = useOrganization();
  const [createOpen, setCreateOpen] = useState(false);
  const [editingAnnouncement, setEditingAnnouncement] =
    useState<AnnouncementEditSnapshot | null>(null);
  const [displayCount, setDisplayCount] = useState(INITIAL_PAGE_SIZE);
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);

  const user = useQuery(
    (api as any).organizations.getCurrentUser,
    effectiveOrganizationId
      ? { organizationId: effectiveOrganizationId }
      : "skip",
  );

  // Convex useQuery is reactive: results update automatically when memos (announcements),
  // reactions, or comments change — no manual cache invalidation needed.
  const announcements = useQuery(
    (api as any).announcements.getAnnouncements,
    effectiveOrganizationId
      ? {
          organizationId: effectiveOrganizationId,
          employeeId:
            currentOrganization?.employeeId ?? user?.employeeId ?? undefined,
        }
      : "skip",
  );

  const setAnnouncementsLastSeen = useMutation(
    (api as any).announcements.setAnnouncementsLastSeen,
  );

  // Mark announcements as seen when user views the page
  useEffect(() => {
    if (effectiveOrganizationId && setAnnouncementsLastSeen) {
      setAnnouncementsLastSeen({
        organizationId: effectiveOrganizationId,
      }).catch(() => {});
    }
  }, [effectiveOrganizationId, setAnnouncementsLastSeen]);

  const visibleAnnouncements = useMemo(
    () => announcements?.slice(0, displayCount) ?? [],
    [announcements, displayCount],
  );
  const hasMore = announcements != null && displayCount < announcements.length;
  const remainingCount =
    announcements != null
      ? Math.min(PAGE_SIZE, announcements.length - displayCount)
      : 0;

  // Intersection Observer: load more when sentinel reaches the viewport
  useEffect(() => {
    if (!hasMore || !loadMoreSentinelRef.current) return;
    const el = loadMoreSentinelRef.current;
    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry?.isIntersecting) {
          setDisplayCount((prev) =>
            Math.min(prev + PAGE_SIZE, announcements?.length ?? prev),
          );
        }
      },
      { rootMargin: "200px", threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, announcements?.length]);

  const handleSeeMore = () => {
    setDisplayCount((prev) =>
      Math.min(prev + PAGE_SIZE, announcements?.length ?? prev),
    );
  };

  const canCreate =
    user?.role === "admin" || user?.role === "hr" || user?.role === "owner";
  if (!effectiveOrganizationId) return null;

  return (
    <MainLayout>
      <div className="p-4 sm:p-6 lg:p-8">
        {/* Header: same vertical alignment as Employees page */}
        <div className="mb-4 sm:mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">
              Announcements
            </h1>
            <p className="text-gray-500 mt-1">
              Company updates and news. Only people in this organization can
              view and comment.
            </p>
          </div>
          {canCreate && (
            <Button
              onClick={() => {
                setEditingAnnouncement(null);
                setCreateOpen(true);
              }}
              className="shrink-0"
            >
              <Plus className="h-4 w-4 mr-2" />
              Create announcement
            </Button>
          )}
        </div>

        {/* Announcements list: constrained width */}
        <div className="max-w-4xl mx-auto space-y-4">
          {announcements === undefined &&
            Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden animate-pulse"
              >
                <div className="p-6 space-y-3">
                  <div className="h-5 w-40 rounded bg-gray-200" />
                  <div className="h-4 w-full rounded bg-gray-100" />
                  <div className="h-4 w-full max-w-xl rounded bg-gray-100" />
                </div>
              </div>
            ))}
          {announcements && announcements.length === 0 && (
            <div className="text-center py-12 border border-dashed border-gray-200 rounded-xl bg-gray-50/80">
              <Bell className="h-12 w-12 text-gray-400 mx-auto mb-3" />
              <p className="text-gray-600 font-medium">No announcements yet</p>
              <p className="text-sm text-gray-500 mt-1">
                {canCreate
                  ? "Create one to share updates with your team."
                  : "Check back later for updates."}
              </p>
              {canCreate && (
                <Button
                  variant="outline"
                  className="mt-4"
                  onClick={() => {
                    setEditingAnnouncement(null);
                    setCreateOpen(true);
                  }}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Create announcement
                </Button>
              )}
            </div>
          )}
          {visibleAnnouncements.map((announcement: any) => (
            <div
              key={announcement._id}
              className="rounded-xl bg-white shadow-sm overflow-hidden border border-gray-100"
            >
              <AnnouncementCard
                announcement={announcement}
                currentUserId={user?._id}
                currentEmployeeId={currentOrganization?.employeeId}
                canReact={true}
                onRequestEdit={(a) => {
                  setCreateOpen(false);
                  setEditingAnnouncement({
                    _id: a._id,
                    title: a.title,
                    content: a.content,
                    targetAudience: a.targetAudience,
                    departments: a.departments,
                    specificEmployees: a.specificEmployees?.map(String),
                    acknowledgementRequired: Boolean(a.acknowledgementRequired),
                    attachments: a.attachments,
                    attachmentContentTypes: a.attachmentContentTypes,
                    authorDisplayName: a.authorDisplayName,
                  });
                }}
              />
            </div>
          ))}

          {/* Sentinel for Intersection Observer: load more when this enters viewport */}
          {hasMore && (
            <div
              ref={loadMoreSentinelRef}
              className="flex flex-col items-center justify-center py-6 gap-3"
            >
              <Button
                variant="outline"
                size="sm"
                onClick={handleSeeMore}
                className="gap-2"
              >
                <ChevronDown className="h-4 w-4" />
                See more
                {remainingCount > 0 && (
                  <span className="text-gray-500">({remainingCount} more)</span>
                )}
              </Button>
            </div>
          )}
        </div>
      </div>

      <CreateAnnouncementModal
        isOpen={createOpen || Boolean(editingAnnouncement)}
        onOpenChange={(open) => {
          if (!open) {
            setCreateOpen(false);
            setEditingAnnouncement(null);
          }
        }}
        organizationId={effectiveOrganizationId}
        editingAnnouncement={editingAnnouncement}
        onSuccess={() => {
          setCreateOpen(false);
          setEditingAnnouncement(null);
        }}
      />
    </MainLayout>
  );
}
