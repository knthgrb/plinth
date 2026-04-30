"use client";

import type { ReactNode } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { formatDistanceToNow } from "date-fns";
import {
  Banknote,
  Bell,
  CalendarClock,
  CircleCheck,
  CircleX,
  Send,
} from "lucide-react";
import { cn } from "@/utils/utils";

export type NotificationRow = {
  _id: Id<"notifications">;
  type: string;
  title: string;
  body?: string;
  read: boolean;
  createdAt: number;
  pathAfterOrg: string;
};

export function isNotificationToday(createdAt: number): boolean {
  const d = new Date(createdAt);
  const t = new Date();
  return (
    d.getFullYear() === t.getFullYear() &&
    d.getMonth() === t.getMonth() &&
    d.getDate() === t.getDate()
  );
}

export function groupNotificationsByToday<T extends { createdAt: number }>(
  items: T[],
): { today: T[]; older: T[] } {
  const today: T[] = [];
  const older: T[] = [];
  for (const it of items) {
    if (isNotificationToday(it.createdAt)) today.push(it);
    else older.push(it);
  }
  return { today, older };
}

export function formatNotificationRelative(createdAt: number): string {
  return formatDistanceToNow(createdAt, { addSuffix: true });
}

function getIconForType(
  type: string,
): { Icon: typeof Bell; className: string; bg: string } {
  switch (type) {
    case "leave_submitted":
      return {
        Icon: Send,
        className: "text-indigo-600",
        bg: "bg-indigo-50",
      };
    case "leave_approved":
      return {
        Icon: CircleCheck,
        className: "text-emerald-600",
        bg: "bg-emerald-50",
      };
    case "leave_rejected":
      return {
        Icon: CircleX,
        className: "text-amber-600",
        bg: "bg-amber-50",
      };
    case "payslip_ready":
      return {
        Icon: Banknote,
        className: "text-[#695eff]",
        bg: "bg-violet-50",
      };
    default:
      return {
        Icon: CalendarClock,
        className: "text-slate-600",
        bg: "bg-slate-100",
      };
  }
}

type NotificationListItemProps = {
  n: NotificationRow;
  onSelect: (n: NotificationRow) => void;
  className?: string;
};

export function NotificationListItem({
  n,
  onSelect,
  className,
}: NotificationListItemProps) {
  const { Icon, className: iconClass, bg } = getIconForType(n.type);
  return (
    <li className={cn("list-none", className)}>
      <button
        type="button"
        className={cn(
          "w-full text-left flex gap-3 rounded-lg px-2 py-2.5 sm:px-3 transition-colors",
          "hover:bg-[rgb(250,250,250)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#695eff]/30",
          !n.read && "bg-violet-50/40",
        )}
        onClick={() => onSelect(n)}
      >
        <div
          className={cn(
            "shrink-0 h-9 w-9 rounded-full flex items-center justify-center",
            bg,
          )}
          aria-hidden
        >
          <Icon className={cn("h-4 w-4", iconClass)} />
        </div>
        <div className="min-w-0 flex-1 flex gap-2">
          <div className="min-w-0 flex-1">
            <p
              className={cn(
                "text-sm leading-snug text-[rgb(40,40,40)]",
                !n.read && "font-semibold",
                n.read && "font-medium",
              )}
            >
              {n.title}
            </p>
            {n.body ? (
              <p className="text-xs text-[rgb(120,120,120)] line-clamp-2 mt-0.5">
                {n.body}
              </p>
            ) : null}
          </div>
          <div className="shrink-0 flex flex-col items-end gap-0.5 pt-0.5">
            <span
              className="text-[11px] text-[rgb(150,150,150)] tabular-nums"
              title={new Date(n.createdAt).toLocaleString()}
            >
              {formatNotificationRelative(n.createdAt)}
            </span>
            {!n.read ? (
              <span
                className="h-2 w-2 rounded-full bg-[#695eff] shrink-0"
                aria-label="Unread"
              />
            ) : (
              <span className="h-2 w-2 shrink-0" aria-hidden />
            )}
          </div>
        </div>
      </button>
    </li>
  );
}

type SectionLabelProps = { children: string };

export function NotificationSectionLabel({ children }: SectionLabelProps) {
  return (
    <p className="px-2 sm:px-1 pt-3 first:pt-0 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[rgb(150,150,150)]">
      {children}
    </p>
  );
}

type NotificationListGroupedProps = {
  items: NotificationRow[];
  onItemSelect: (n: NotificationRow) => void;
  /** When "Unread" and empty, hide Today/Older labels in empty list */
  emptyState?: ReactNode;
};

export function NotificationListGrouped({
  items,
  onItemSelect,
  emptyState,
}: NotificationListGroupedProps) {
  const { today, older } = groupNotificationsByToday(items);

  if (items.length === 0) {
    return <>{emptyState}</>;
  }

  return (
    <div className="space-y-0.5">
      {today.length > 0 && (
        <div>
          <NotificationSectionLabel>Today</NotificationSectionLabel>
          <ul className="space-y-0.5">
            {today.map((n) => (
              <NotificationListItem
                key={String(n._id)}
                n={n}
                onSelect={onItemSelect}
              />
            ))}
          </ul>
        </div>
      )}
      {older.length > 0 && (
        <div>
          <NotificationSectionLabel>Older</NotificationSectionLabel>
          <ul className="space-y-0.5">
            {older.map((n) => (
              <NotificationListItem
                key={String(n._id)}
                n={n}
                onSelect={onItemSelect}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
