"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { MainLayout } from "@/components/layout/main-layout";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useOrganization } from "@/hooks/organization-context";
import { getOrganizationPath } from "@/utils/organization-routing";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/utils/utils";

const PAGE_SIZE = 20;

export function NotificationsPageClient() {
  const router = useRouter();
  const { effectiveOrganizationId } = useOrganization();
  const orgId = effectiveOrganizationId as Id<"organizations"> | undefined;
  const [cursor, setCursor] = useState<number | undefined>(undefined);
  const [items, setItems] = useState<
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

  const ap = api as any;
  const pageData = useQuery(
    ap.notifications.listNotificationsPage,
    orgId
      ? { organizationId: orgId, limit: PAGE_SIZE, cursor }
      : "skip",
  );

  const markRead = useMutation(ap.notifications.markNotificationRead);
  const markAllRead = useMutation(ap.notifications.markAllNotificationsRead);

  useEffect(() => {
    if (!pageData) return;
    setItems((prev) => {
      if (cursor === undefined) {
        return pageData.items;
      }
      const seen = new Set(prev.map((x) => String(x._id)));
      const add = pageData.items.filter(
        (x: { _id: Id<"notifications"> }) => !seen.has(String(x._id)),
      );
      return [...prev, ...add];
    });
    setHasMore(pageData.hasMore);
    setLoadingMore(false);
  }, [pageData, cursor]);

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
        <div className="p-6">Loading…</div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="p-4 sm:p-6 max-w-2xl mx-auto">
        <div className="flex items-center justify-between gap-4 mb-4">
          <h1 className="text-lg font-semibold">Notifications</h1>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={async () => {
              try {
                await markAllRead({ organizationId: orgId });
                setItems((rows) => rows.map((r) => ({ ...r, read: true })));
              } catch {
                /* empty */
              }
            }}
          >
            Mark all as read
          </Button>
        </div>
        {pageData === undefined && items.length === 0 && (
          <div className="flex justify-center py-12 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        )}
        <ul className="border rounded-lg divide-y bg-card">
          {items.length === 0 && pageData && (
            <li className="p-8 text-center text-sm text-muted-foreground">
              No notifications yet
            </li>
          )}
          {items.map((n) => (
            <li key={String(n._id)}>
              <button
                type="button"
                className={cn(
                  "w-full text-left px-4 py-3 text-sm hover:bg-muted/50 transition-colors",
                  !n.read && "bg-muted/20",
                )}
                onClick={() => void onRowClick(n)}
              >
                <div className={cn("font-medium", !n.read && "text-foreground")}>
                  {n.title}
                </div>
                {n.body && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {n.body}
                  </p>
                )}
                <p className="text-[10px] text-muted-foreground mt-1">
                  {new Date(n.createdAt).toLocaleString()}
                </p>
              </button>
            </li>
          ))}
        </ul>
        {hasMore && items.length > 0 && (
          <div
            ref={sentinelRef}
            className="h-10 flex items-center justify-center"
          >
            {loadingMore && (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            )}
          </div>
        )}
      </div>
    </MainLayout>
  );
}
