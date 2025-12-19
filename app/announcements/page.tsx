"use client";

import { useState, lazy, Suspense } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { MainLayout } from "@/components/layout/main-layout";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { useOrganization } from "@/hooks/organization-context";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { AnnouncementCard } from "./_components/announcement-card";

// Lazy load the create announcement modal
const CreateAnnouncementModal = lazy(() =>
  import("./_components/create-announcement-modal").then((mod) => ({
    default: mod.CreateAnnouncementModal,
  }))
);

export default function AnnouncementsPage() {
  const { currentOrganizationId } = useOrganization();
  const router = useRouter();

  const user = useQuery((api as any).organizations.getCurrentUser, {
    organizationId: currentOrganizationId || undefined,
  });

  const announcements = useQuery(
    (api as any).announcements.getAnnouncements,
    currentOrganizationId
      ? {
          organizationId: currentOrganizationId,
          employeeId: user?.employeeId || undefined,
        }
      : "skip"
  );

  // Redirect if not authenticated or no organization
  useEffect(() => {
    if (user === null) {
      router.push("/login");
    }
  }, [user, router]);

  // Announcement creation state
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const isAdminOrHr = user?.role === "admin" || user?.role === "hr";
  const canReact =
    user?.role === "employee" ||
    user?.role === "hr" ||
    user?.role === "accounting" ||
    user?.role === "admin";

  if (!currentOrganizationId) return null;

  if (user === undefined) {
    return (
      <MainLayout>
        <div className="flex h-screen items-center justify-center">
          <div className="text-gray-500">Loading...</div>
        </div>
      </MainLayout>
    );
  }

  // Group announcements by date
  const groupedAnnouncements = announcements
    ? announcements.reduce((groups: any, announcement: any) => {
        const date = new Date(announcement.publishedDate);
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);

        let dateKey: string;
        if (date.toDateString() === today.toDateString()) {
          dateKey = "Today";
        } else if (date.toDateString() === yesterday.toDateString()) {
          dateKey = "Yesterday";
        } else {
          dateKey = date.toLocaleDateString("en-US", {
            month: "long",
            day: "numeric",
            year: "numeric",
          });
        }

        if (!groups[dateKey]) {
          groups[dateKey] = [];
        }
        groups[dateKey].push(announcement);
        return groups;
      }, {})
    : {};

  return (
    <MainLayout>
      <div className="flex h-full flex-col min-h-0">
        {/* Header */}
        <div className="border-b border-gray-200 bg-white p-6 shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                Announcements
              </h1>
            </div>
            {isAdminOrHr && (
              <Button onClick={() => setIsDialogOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Create Announcement
              </Button>
            )}
          </div>
        </div>

        {/* Messages Feed */}
        <div className="flex-1 overflow-y-auto bg-gray-50 min-h-0">
          <div className="max-w-4xl mx-auto p-4 pb-6">
            {announcements === undefined ? (
              <div className="flex items-center justify-center py-12">
                <div className="text-gray-500">Loading announcements...</div>
              </div>
            ) : announcements?.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12">
                <div className="text-gray-500 mb-4">No announcements yet</div>
                {isAdminOrHr && (
                  <Button onClick={() => setIsDialogOpen(true)}>
                    <Plus className="mr-2 h-4 w-4" />
                    Create First Announcement
                  </Button>
                )}
              </div>
            ) : (
              Object.entries(groupedAnnouncements).map(([dateKey, items]) => (
                <div key={dateKey} className="mb-6 last:mb-0">
                  {/* Date Separator */}
                  <div className="flex items-center gap-4 mb-4">
                    <div className="flex-1 border-t border-gray-300"></div>
                    <span className="text-xs font-medium text-gray-500 uppercase">
                      {dateKey}
                    </span>
                    <div className="flex-1 border-t border-gray-300"></div>
                  </div>

                  {/* Announcements for this date */}
                  <div className="space-y-1">
                    {(items as any[]).map((announcement: any) => (
                      <div
                        key={announcement._id}
                        className="bg-white rounded-lg border border-gray-200 shadow-sm"
                      >
                        <AnnouncementCard
                          announcement={announcement}
                          currentUserId={user?._id}
                          currentEmployeeId={user?.employeeId}
                          isAdminOrHr={isAdminOrHr}
                          canReact={canReact}
                          onDelete={() => {
                            // Refetch will happen automatically via Convex
                          }}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Lazy loaded Create Announcement Modal */}
      {isDialogOpen && (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
              <div className="bg-white rounded-lg p-4">Loading...</div>
            </div>
          }
        >
          <CreateAnnouncementModal
            isOpen={isDialogOpen}
            onOpenChange={setIsDialogOpen}
            organizationId={currentOrganizationId}
            onSuccess={() => {
              setIsDialogOpen(false);
            }}
          />
        </Suspense>
      )}
    </MainLayout>
  );
}
