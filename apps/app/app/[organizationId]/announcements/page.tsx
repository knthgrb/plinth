"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Bell, ChevronDown, Plus } from "lucide-react";
import { AnnouncementCard } from "./_components/announcement-card";
import type { AnnouncementEditSnapshot } from "./_components/create-announcement-modal";
import { MainLayout } from "@/components/layout/main-layout";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useEmployeeView } from "@/hooks/employee-view-context";
import { useOrganization } from "@/hooks/organization-context";

const CreateAnnouncementModal = dynamic(
  () =>
    import("./_components/create-announcement-modal").then(
      (module) => module.CreateAnnouncementModal,
    ),
  { ssr: false },
);

const PAGE_SIZE = 10;
type StatusFilter = "all" | "published" | "scheduled";

export default function AnnouncementsPage() {
  const { effectiveOrganizationId } = useOrganization();
  const { isEmployeeExperienceUI } = useEmployeeView();
  const organizationId = effectiveOrganizationId as
    | Id<"organizations">
    | undefined;
  const user = useQuery(
    api.organizations.getCurrentUser,
    organizationId ? { organizationId } : "skip",
  );
  const canManage =
    !isEmployeeExperienceUI &&
    (user?.role === "owner" || user?.role === "admin" || user?.role === "hr");
  const includeScheduled = canManage;
  const announcements = useQuery(
    api.announcements.getAnnouncements,
    organizationId ? { organizationId, includeScheduled } : "skip",
  );
  const linkedEmployee = useQuery(
    api.employees.getEmployee,
    user?.employeeId ? { employeeId: user.employeeId } : "skip",
  );
  const linkedEmployeeName = linkedEmployee
    ? `${linkedEmployee.personalInfo.firstName} ${linkedEmployee.personalInfo.lastName}`.trim()
    : undefined;
  const markSeen = useMutation(api.announcements.setAnnouncementsLastSeen);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingAnnouncement, setEditingAnnouncement] =
    useState<AnnouncementEditSnapshot | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!organizationId) return;
    void markSeen({ organizationId }).catch(() => undefined);
  }, [markSeen, organizationId]);

  const effectiveStatusFilter = canManage ? statusFilter : "published";
  const filteredAnnouncements = useMemo(() => {
    const items = announcements ?? [];
    if (effectiveStatusFilter === "all") return items;
    return items.filter(
      (announcement) =>
        announcement.publicationStatus === effectiveStatusFilter,
    );
  }, [announcements, effectiveStatusFilter]);
  const visibleAnnouncements = filteredAnnouncements.slice(0, displayCount);
  const hasMore = displayCount < filteredAnnouncements.length;
  const publishedCount =
    announcements?.filter(
      (announcement) => announcement.publicationStatus === "published",
    ).length ?? 0;
  const scheduledCount =
    announcements?.filter(
      (announcement) => announcement.publicationStatus === "scheduled",
    ).length ?? 0;

  useEffect(() => {
    const element = loadMoreRef.current;
    if (!element || !hasMore) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setDisplayCount((current) =>
            Math.min(current + PAGE_SIZE, filteredAnnouncements.length),
          );
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [filteredAnnouncements.length, hasMore]);

  if (!organizationId) return null;

  const openCreate = () => {
    setEditingAnnouncement(null);
    setModalOpen(true);
  };

  return (
    <MainLayout>
      <div className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8">
        <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">
              Announcements
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-gray-500 sm:text-base">
              Important organization updates, shared with the right people at the
              right time.
            </p>
          </div>
          {canManage && (
            <Button onClick={openCreate} className="shrink-0">
              <Plus className="h-4 w-4" /> New announcement
            </Button>
          )}
        </header>

        {canManage && announcements && (
          <div className="mb-5 flex flex-wrap items-center gap-2">
            {(
              [
                ["all", "All", announcements.length],
                ["published", "Published", publishedCount],
                ["scheduled", "Scheduled", scheduledCount],
              ] as const
            ).map(([value, label, count]) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={statusFilter === value ? "default" : "outline"}
                onClick={() => {
                  setStatusFilter(value);
                  setDisplayCount(PAGE_SIZE);
                }}
              >
                {label} <span className="opacity-70">{count}</span>
              </Button>
            ))}
          </div>
        )}

        <div className="mx-auto max-w-4xl space-y-4">
          {announcements === undefined &&
            Array.from({ length: 3 }, (_, index) => (
              <div
                key={index}
                className="h-52 animate-pulse rounded-2xl border bg-white shadow-sm"
              />
            ))}

          {announcements && filteredAnnouncements.length === 0 && (
            <div className="rounded-2xl border border-dashed bg-gray-50/70 px-6 py-14 text-center">
              <Bell className="mx-auto h-10 w-10 text-gray-300" />
              <h2 className="mt-3 font-semibold text-gray-900">
                {effectiveStatusFilter === "scheduled"
                  ? "No scheduled announcements"
                  : "No announcements yet"}
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                {canManage
                  ? "Create a focused update for your organization."
                  : "New organization updates will appear here."}
              </p>
              {canManage && effectiveStatusFilter !== "scheduled" && (
                <Button variant="outline" className="mt-4" onClick={openCreate}>
                  <Plus className="h-4 w-4" /> New announcement
                </Button>
              )}
            </div>
          )}

          {visibleAnnouncements.map((announcement) => (
            <AnnouncementCard
              key={announcement._id}
              announcement={announcement}
              organizationId={organizationId}
              currentUserId={user?._id}
              canManage={canManage}
              linkedEmployeeName={linkedEmployeeName}
              includeScheduled={includeScheduled}
              onRequestEdit={(selected) => {
                setEditingAnnouncement({
                  _id: selected._id,
                  title: selected.title,
                  content: selected.content,
                  priority: selected.priority,
                  targetAudience: selected.targetAudience,
                  departments: selected.departments,
                  specificEmployees: selected.specificEmployees.map(String),
                  scheduledPublishDate: selected.scheduledPublishDate,
                  publicationStatus: selected.publicationStatus,
                  attachments: selected.attachments.map(String),
                  attachmentContentTypes: selected.attachmentContentTypes,
                  authorPersona: selected.authorPersona,
                });
                setModalOpen(true);
              }}
            />
          ))}

          {hasMore && (
            <div ref={loadMoreRef} className="flex justify-center py-5">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setDisplayCount((current) => current + PAGE_SIZE)
                }
              >
                <ChevronDown className="h-4 w-4" /> Load more
              </Button>
            </div>
          )}
        </div>
      </div>

      <CreateAnnouncementModal
        isOpen={modalOpen}
        onOpenChange={(open) => {
          setModalOpen(open);
          if (!open) setEditingAnnouncement(null);
        }}
        organizationId={organizationId}
        editingAnnouncement={editingAnnouncement}
        onSuccess={() => {
          setModalOpen(false);
          setEditingAnnouncement(null);
        }}
      />
    </MainLayout>
  );
}
