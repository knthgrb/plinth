"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Bell, CheckCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useOrganization } from "@/hooks/organization-context";
import { getOrganizationPath } from "@/utils/organization-routing";
import type { Id } from "@/convex/_generated/dataModel";
import {
  NotificationListGrouped,
  type NotificationRow,
} from "./notification-views";

const PAGE_SIZE = 10;

export function NotificationBell() {
  const router = useRouter();
  const { effectiveOrganizationId } = useOrganization();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"all" | "unread">("all");
  const [cursor, setCursor] = useState<number | undefined>(undefined);
  const [accumulated, setAccumulated] = useState<NotificationRow[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const orgId = effectiveOrganizationId as Id<"organizations"> | undefined;
  const unreadOnly = tab === "unread";

  const ap = api as any;
  const unread = useQuery(
    ap.notifications.getUnreadNotificationCount,
    orgId ? { organizationId: orgId } : "skip",
  );
  const tabCounts = useQuery(
    ap.notifications.getNotificationTabCounts,
    orgId && open ? { organizationId: orgId } : "skip",
  );
  const pageDataAll = useQuery(
    ap.notifications.listNotificationsPage,
    orgId && open && !unreadOnly
      ? { organizationId: orgId, limit: PAGE_SIZE, cursor }
      : "skip",
  );
  const pageDataUnread = useQuery(
    ap.notifications.listNotificationsPage,
    orgId && open && unreadOnly
      ? { organizationId: orgId, limit: PAGE_SIZE, cursor, unreadOnly: true }
      : "skip",
  );
  const pageData = unreadOnly ? pageDataUnread : pageDataAll;

  const markRead = useMutation(ap.notifications.markNotificationRead);
  const markAllRead = useMutation(ap.notifications.markAllNotificationsRead);

  const resetList = useCallback(() => {
    setCursor(undefined);
    setAccumulated([]);
    setHasMore(true);
  }, []);

  useEffect(() => {
    if (!open) {
      setTab("all");
      resetList();
    }
  }, [open, resetList]);

  useEffect(() => {
    if (!open) return;
    resetList();
  }, [tab, resetList, open]);

  useEffect(() => {
    if (!open || !pageData) return;
    setAccumulated((prev) => {
      if (cursor === undefined) {
        return pageData.items as NotificationRow[];
      }
      const seen = new Set(prev.map((x) => String(x._id)));
      return [
        ...prev,
        ...((pageData.items as NotificationRow[]).filter(
          (it) => !seen.has(String(it._id)),
        ) ?? []),
      ];
    });
    setHasMore(pageData.hasMore);
    setLoadingMore(false);
  }, [pageData, open, cursor, unreadOnly]);

  const loadMore = useCallback(() => {
    if (!orgId || !pageData || !pageData.hasMore || loadingMore) return;
    setLoadingMore(true);
    setCursor(pageData.nextCursor ?? undefined);
  }, [orgId, pageData, loadingMore]);

  useEffect(() => {
    if (!open) return;
    const el = sentinelRef.current;
    if (!el) return;
    const ob = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !loadingMore) {
          loadMore();
        }
      },
      { root: null, rootMargin: "0px", threshold: 0.1 },
    );
    ob.observe(el);
    return () => ob.disconnect();
  }, [open, hasMore, loadingMore, loadMore]);

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setCursor(undefined);
      setAccumulated([]);
      setHasMore(true);
      setTab("all");
    }
  };

  const handleItemClick = async (n: {
    _id: Id<"notifications">;
    pathAfterOrg: string;
    read: boolean;
  }) => {
    if (!orgId) return;
    if (!n.read) {
      try {
        await markRead({ notificationId: n._id });
      } catch {
        // still navigate
      }
    }
    router.push(
      getOrganizationPath(
        orgId,
        n.pathAfterOrg.startsWith("/")
          ? n.pathAfterOrg
          : `/${n.pathAfterOrg}`,
      ),
    );
    setOpen(false);
  };

  const handleMarkAllRead = async () => {
    if (!orgId) return;
    try {
      await markAllRead({ organizationId: orgId });
    } catch {
      /* empty */
    }
  };

  const count = unread?.count ?? 0;
  const show = accumulated;
  const totalCount = tabCounts?.total ?? 0;
  const allUnread = tabCounts?.unread ?? count;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="relative h-9 w-9 rounded-full"
          aria-label="Notifications"
        >
          <Bell className="h-4.5 w-4.5 text-gray-900" />
          {count > 0 && (
            <span
              className="absolute -top-0.5 -right-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#695eff] px-1 text-[10px] font-semibold text-white"
              aria-hidden
            >
              {count > 99 ? "99+" : count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[min(100vw-1.5rem,400px)] p-0 overflow-hidden rounded-xl border-0 bg-white shadow-lg ring-1 ring-black/5"
        align="end"
        side="bottom"
        sideOffset={8}
      >
        <div className="px-4 pt-3 pb-2 flex items-center justify-between gap-2">
          <h2 className="text-[15px] font-semibold text-[rgb(40,40,40)] tracking-tight">
            Your notifications
          </h2>
          {count > 0 && (
            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs font-medium text-[#695eff] hover:text-[#5547e8] transition-colors"
              onClick={() => void handleMarkAllRead()}
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Mark all as read
            </button>
          )}
        </div>
        {orgId && (
          <div className="px-3 pb-2">
            <Tabs
              value={tab}
              onValueChange={(v) => setTab(v as "all" | "unread")}
            >
              <TabsList className="w-full h-9 p-0.5 gap-0 rounded-lg bg-[rgb(245,245,245)]">
                <TabsTrigger
                  value="all"
                  className="flex-1 rounded-md text-xs sm:text-sm gap-1"
                >
                  <span>All</span>
                  {tabCounts && totalCount > 0 && (
                    <span className="text-[11px] font-medium text-[rgb(133,133,133)] tabular-nums">
                      {totalCount}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger
                  value="unread"
                  className="flex-1 rounded-md text-xs sm:text-sm gap-1"
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
        )}
        <div className="h-[min(70vh,380px)] overflow-y-auto overflow-x-hidden px-2 pb-1">
          {show.length === 0 && pageData === undefined && open && (
            <div className="py-10 flex flex-col items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mb-2" />
            </div>
          )}
          {show.length === 0 && pageData && (
            <p className="px-2 py-10 text-center text-sm text-[rgb(150,150,150)]">
              {unreadOnly
                ? "No unread notifications"
                : "No notifications yet"}
            </p>
          )}
          {show.length > 0 && (
            <div className="px-0.5 pt-0.5 pb-2">
              <NotificationListGrouped
                items={show}
                onItemSelect={(n) => void handleItemClick(n)}
                emptyState={null}
              />
            </div>
          )}
          {hasMore && show.length > 0 && (
            <div
              ref={sentinelRef}
              className="h-6 w-full flex items-center justify-center py-1"
            >
              {loadingMore && (
                <Loader2 className="h-4 w-4 animate-spin text-[rgb(150,150,150)]" />
              )}
            </div>
          )}
        </div>
        {orgId && (
          <div className="px-1 py-2.5 border-t border-[rgb(240,240,240)]">
            <Button
              type="button"
              variant="link"
              className="h-auto w-full p-2 text-sm text-[#695eff] font-medium hover:text-[#5547e8]"
              onClick={() => {
                setOpen(false);
                router.push(getOrganizationPath(orgId, "/notifications"));
              }}
            >
              View all notifications
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
