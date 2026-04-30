"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { MainLayout } from "@/components/layout/main-layout";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CheckCheck, Loader2 } from "lucide-react";
import { useOrganization } from "@/hooks/organization-context";
import { useEmployeeView } from "@/hooks/employee-view-context";
import { getOrganizationPath } from "@/utils/organization-routing";
import type { Id } from "@/convex/_generated/dataModel";
import {
  NotificationListGrouped,
  type NotificationRow,
} from "@/components/notifications/notification-views";

const PAGE_SIZE = 20;

export function NotificationsPageClient() {
  const router = useRouter();
  const { effectiveOrganizationId } = useOrganization();
  const { isEmployeeExperienceUI } = useEmployeeView();
  const orgId = effectiveOrganizationId as Id<"organizations"> | undefined;
  const [tab, setTab] = useState<"all" | "unread">("all");
  const [cursor, setCursor] = useState<number | undefined>(undefined);
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const unreadOnly = tab === "unread";

  const ap = api as any;
  const tabCounts = useQuery(
    ap.notifications.getNotificationTabCounts,
    orgId
      ? {
          organizationId: orgId,
          forEmployeeExperience: isEmployeeExperienceUI,
        }
      : "skip",
  );
  const pageDataAll = useQuery(
    ap.notifications.listNotificationsPage,
    orgId && !unreadOnly
      ? {
          organizationId: orgId,
          limit: PAGE_SIZE,
          cursor,
          forEmployeeExperience: isEmployeeExperienceUI,
        }
      : "skip",
  );
  const pageDataUnread = useQuery(
    ap.notifications.listNotificationsPage,
    orgId && unreadOnly
      ? {
          organizationId: orgId,
          limit: PAGE_SIZE,
          cursor,
          unreadOnly: true,
          forEmployeeExperience: isEmployeeExperienceUI,
        }
      : "skip",
  );
  const pageData = unreadOnly ? pageDataUnread : pageDataAll;

  const markRead = useMutation(ap.notifications.markNotificationRead);
  const markAllRead = useMutation(ap.notifications.markAllNotificationsRead);

  const resetList = useCallback(() => {
    setCursor(undefined);
    setItems([]);
    setHasMore(true);
  }, []);

  useEffect(() => {
    resetList();
  }, [tab, resetList]);

  useEffect(() => {
    if (!pageData) return;
    setItems((prev) => {
      if (cursor === undefined) {
        return pageData.items as NotificationRow[];
      }
      const seen = new Set(prev.map((x) => String(x._id)));
      const add = (pageData.items as NotificationRow[]).filter(
        (x) => !seen.has(String(x._id)),
      );
      return [...prev, ...add];
    });
    setHasMore(pageData.hasMore);
    setLoadingMore(false);
  }, [pageData, cursor, unreadOnly]);

  const loadMore = useCallback(() => {
    if (!orgId || !pageData?.hasMore || loadingMore) return;
    setLoadingMore(true);
    setCursor(pageData.nextCursor ?? undefined);
  }, [orgId, pageData, loadingMore]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const ob = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          loadMore();
        }
      },
      { root: null, rootMargin: "80px", threshold: 0 },
    );
    ob.observe(el);
    return () => ob.disconnect();
  }, [loadMore]);

  const onRowClick = async (n: {
    _id: Id<"notifications">;
    pathAfterOrg: string;
    read: boolean;
  }) => {
    if (!orgId) return;
    if (!n.read) {
      try {
        await markRead({ notificationId: n._id });
        setItems((rows) =>
          rows.map((r) => (r._id === n._id ? { ...r, read: true } : r)),
        );
      } catch {
        /* still navigate */
      }
    }
    const path = n.pathAfterOrg.startsWith("/")
      ? n.pathAfterOrg
      : `/${n.pathAfterOrg}`;
    router.push(getOrganizationPath(orgId, path));
  };

  if (!orgId) {
    return (
      <MainLayout>
        <div className="p-6 text-sm text-[rgb(120,120,120)]">Loading…</div>
      </MainLayout>
    );
  }

  const totalCount = tabCounts?.total ?? 0;
  const allUnread = tabCounts?.unread ?? 0;

  return (
    <MainLayout>
      <div className="p-4 sm:p-6 max-w-2xl mx-auto w-full">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <h1 className="text-lg font-semibold text-[rgb(40,40,40)]">
            Notifications
          </h1>
          {allUnread > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0 border-[#DDDDDD] text-[rgb(64,64,64)] hover:bg-[rgb(250,250,250)] gap-1.5"
              onClick={async () => {
                try {
                  await markAllRead({
                    organizationId: orgId,
                    forEmployeeExperience: isEmployeeExperienceUI,
                  });
                  setItems((rows) => rows.map((r) => ({ ...r, read: true })));
                } catch {
                  /* empty */
                }
              }}
            >
              <CheckCheck className="h-3.5 w-3.5 text-[#695eff]" />
              Mark all as read
            </Button>
          )}
        </div>

        <div className="mb-4">
          <Tabs
            value={tab}
            onValueChange={(v) => setTab(v as "all" | "unread")}
          >
            <TabsList className="h-9 w-full sm:w-auto p-0.5 gap-0 rounded-lg bg-[rgb(245,245,245)]">
              <TabsTrigger
                value="all"
                className="flex-1 sm:flex-initial min-w-0 rounded-md text-sm gap-1.5 px-4"
              >
                <span>All notifications</span>
                {tabCounts && totalCount > 0 && (
                  <span className="text-[11px] font-medium text-[rgb(133,133,133)] tabular-nums">
                    {totalCount}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger
                value="unread"
                className="flex-1 sm:flex-initial min-w-0 rounded-md text-sm gap-1.5 px-4"
              >
                <span>Unread</span>
                {allUnread > 0 && (
                  <span className="text-[11px] font-medium text-[rgb(133,133,133)] tabular-nums">
                    {allUnread}
                  </span>
                )}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {pageData === undefined && items.length === 0 && (
          <div className="flex justify-center py-16 text-[rgb(150,150,150)]">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        )}

        <div className="rounded-xl bg-white p-1 sm:p-2 ring-1 ring-black/5 shadow-sm">
          {items.length === 0 && pageData && (
            <p className="px-3 py-14 text-center text-sm text-[rgb(150,150,150)]">
              {unreadOnly
                ? "You’re all caught up — no unread notifications."
                : "No notifications yet."}
            </p>
          )}
          {items.length > 0 && (
            <div className="px-1 sm:px-2 py-1">
              <NotificationListGrouped
                items={items}
                onItemSelect={(n) => void onRowClick(n)}
                emptyState={null}
              />
            </div>
          )}
        </div>

        {hasMore && items.length > 0 && (
          <div
            ref={sentinelRef}
            className="h-10 flex items-center justify-center"
          >
            {loadingMore && (
              <Loader2 className="h-4 w-4 animate-spin text-[rgb(150,150,150)]" />
            )}
          </div>
        )}
      </div>
    </MainLayout>
  );
}
