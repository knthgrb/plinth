"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Bell, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useOrganization } from "@/hooks/organization-context";
import { getOrganizationPath } from "@/utils/organization-routing";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/utils/utils";

const PAGE_SIZE = 10;

export function NotificationBell() {
  const router = useRouter();
  const { effectiveOrganizationId } = useOrganization();
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState<number | undefined>(undefined);
  const [accumulated, setAccumulated] = useState<
    Array<{
      _id: Id<"notifications">;
      title: string;
      body?: string;
      read: boolean;
      createdAt: number;
      pathAfterOrg: string;
    }>
  >([]);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const orgId = effectiveOrganizationId as Id<"organizations"> | undefined;

  const ap = api as any;
  const unread = useQuery(
    ap.notifications.getUnreadNotificationCount,
    orgId ? { organizationId: orgId } : "skip",
  );
  const pageData = useQuery(
    ap.notifications.listNotificationsPage,
    orgId && open
      ? { organizationId: orgId, limit: PAGE_SIZE, cursor }
      : "skip",
  );

  const markRead = useMutation(ap.notifications.markNotificationRead);
  const markAllRead = useMutation(ap.notifications.markAllNotificationsRead);

  const resetList = useCallback(() => {
    setCursor(undefined);
    setAccumulated([]);
    setHasMore(true);
  }, []);

  useEffect(() => {
    if (!open) {
      resetList();
    }
  }, [open, resetList]);

  useEffect(() => {
    if (!open || !pageData) return;
    setAccumulated((prev) => {
      if (cursor === undefined) {
        return pageData.items;
      }
      const seen = new Set(prev.map((x) => String(x._id)));
      return [
        ...prev,
        ...pageData.items.filter(
          (it: { _id: Id<"notifications"> }) =>
            !seen.has(String(it._id)),
        ),
      ];
    });
    setHasMore(pageData.hasMore);
    setLoadingMore(false);
  }, [pageData, open, cursor]);

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
        className="w-[min(100vw-1.5rem,380px)] p-0"
        align="end"
        side="bottom"
      >
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-semibold">Notifications</span>
          {count > 0 && (
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => void handleMarkAllRead()}
            >
              Mark all as read
            </button>
          )}
        </div>
        <div className="h-[min(70vh,360px)] overflow-y-auto">
          <ul className="p-0">
            {show.length === 0 && pageData === undefined && open && (
              <li className="px-3 py-6 text-center text-sm text-muted-foreground">
                <Loader2 className="mx-auto h-5 w-5 animate-spin" />
              </li>
            )}
            {show.length === 0 && pageData && (
              <li className="px-3 py-6 text-center text-sm text-muted-foreground">
                No notifications yet
              </li>
            )}
            {show.map((n) => (
              <li key={String(n._id)} className="border-b last:border-0">
                <button
                  type="button"
                  className={cn(
                    "w-full text-left px-3 py-2.5 text-sm transition-colors hover:bg-muted/50",
                    !n.read && "bg-muted/30",
                  )}
                  onClick={() => void handleItemClick(n)}
                >
                  <div
                    className={cn("font-medium", !n.read && "text-foreground")}
                  >
                    {n.title}
                  </div>
                  {n.body && (
                    <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                      {n.body}
                    </p>
                  )}
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {new Date(n.createdAt).toLocaleString()}
                  </p>
                </button>
              </li>
            ))}
            {hasMore && show.length > 0 && (
              <li className="list-none">
                <div
                  ref={sentinelRef}
                  className="h-6 w-full flex items-center justify-center"
                >
                  {loadingMore && (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  )}
                </div>
              </li>
            )}
          </ul>
        </div>
        {orgId && (
          <div className="border-t px-2 py-2">
            <Button
              type="button"
              variant="link"
              className="h-auto w-full p-2 text-sm text-[#695eff]"
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
