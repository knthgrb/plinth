import { Suspense } from "react";
import { NotificationsPageClient } from "./notifications-page-client";

export default function NotificationsPage() {
  return (
    <Suspense
      fallback={
        <div className="p-6 text-sm text-muted-foreground">Loading…</div>
      }
    >
      <NotificationsPageClient />
    </Suspense>
  );
}
